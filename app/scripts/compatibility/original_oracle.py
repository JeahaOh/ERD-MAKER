#!/usr/bin/env python3
"""Run the user's unmodified vendor serializer as a LOCAL test oracle.

No vendor bytes are copied into application sources or release artifacts.
Requires JDK 21 and Eclipse plugins (ECLIPSE_PLUGINS, defaults to DBeaver on macOS).
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import struct
import zlib
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / '.analysis/oracle'
PLUGIN_NAMES = ('com.tomato.exerd.model_', 'com.tomato.exerd.term.model_', 'com.tomato.devkit_',
                'com.tomato.exerd.library_',
                'com.tomato.exerd.product.postgresql.model_', 'com.tomato.exerd.product.mysql.model_',
                'com.tomato.exerd.product.oracle.model_', 'com.tomato.exerd.product.sqlserver.model_',
                'com.tomato.exerd.product.db2.model_', 'com.tomato.exerd.product.cubrid.model_',
                'com.tomato.exerd.product.mariadb_', 'com.tomato.exerd.product.tibero_',
                'kr.co.tomatosystem.draw2d_', 'org.eclipse.xtext.xbase.lib_', 'com.google.guava_')


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(args: list[str]) -> str:
    p = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    print(p.stdout, end='')
    if p.stderr:
        print(p.stderr, end='', file=sys.stderr)
    if p.returncode:
        raise RuntimeError(f'{args[0]} failed: exit {p.returncode}')
    return p.stdout + p.stderr


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, nargs='?')
    parser.add_argument('--generate-fixtures', type=Path, help='Generate 8 independent original-factory models in a new .analysis directory; no input is read')
    parser.add_argument('--describe', action='store_true', help='Require original GUI content recognizer to accept the input')
    parser.add_argument('--transform', action='store_true', help='Use original ITransformService migration, then original XML reader; never raw binary reading')
    parser.add_argument('--xml', action='store_true', help='Independently load XML entry using original ERDXResourceImpl')
    parser.add_argument('--term', action='store_true', help='Load plain .xdic XML with original TermModelPackage/EFactory and EMF XMLResourceImpl; no GUI')
    parser.add_argument('--select-uuid', action='append', default=[], help='Include selected UUID and names in stdout JSON')
    parser.add_argument('--save', type=Path, help='Write a new file with the original serializer')
    parser.add_argument('--plugins', type=Path, default=Path(os.environ.get('ECLIPSE_PLUGINS', '/Applications/DBeaver.app/Contents/Eclipse/plugins')))
    args = parser.parse_args()
    if args.input is None and not args.generate_fixtures:
        parser.error('input or --generate-fixtures is required')
    source = args.input.resolve() if args.input is not None else None
    if args.transform and args.xml:
        parser.error('--transform already loads migrated XML; do not combine with --xml')
    if args.term and (args.xml or args.transform or args.describe or args.generate_fixtures):
        parser.error('--term cannot be combined with model/XML-entry/fixture modes')
    if args.save:
        dest = args.save.resolve()
        if dest == source or (ROOT / 'REF').resolve() in dest.parents:
            parser.error('Saving over the input or into REF is forbidden')
        if dest.exists():
            parser.error('Output already exists; choose a new destination')
        dest.parent.mkdir(parents=True, exist_ok=True)
    plugins = args.plugins.resolve()
    if not plugins.is_dir():
        parser.error('Set --plugins or ECLIPSE_PLUGINS to an installed Eclipse plugins directory')
    for folder in ('lib', 'classes', 'output'):
        (WORK / folder).mkdir(parents=True, exist_ok=True)
    extracted = []
    with ZipFile(ROOT / 'REF/updateSite.zip') as archive:
        for name in archive.namelist():
            if name.startswith('plugins/') and name.endswith('.jar') and Path(name).name.startswith(PLUGIN_NAMES):
                target = WORK / 'lib' / Path(name).name
                target.write_bytes(archive.read(name))
                extracted.append(target)
                with ZipFile(target) as nested:
                    # Only model's standalone XML libraries are required; do not load arbitrary nested JDBC libraries.
                    if Path(name).name.startswith('com.tomato.exerd.model_'):
                        for member in ('lib/jaxen.jar', 'lib/jdom.jar'):
                            dep = WORK / 'lib' / (target.stem + '-' + Path(member).name)
                            dep.write_bytes(nested.read(member))
                            extracted.append(dep)
    # Restrict the runtime directory to the selected jars through an explicit generated list.
    classpath = os.pathsep.join(map(str, extracted + sorted(plugins.glob('*.jar'))))
    sources = [str(ROOT / 'app/scripts/compatibility' / name) for name in ('OracleBootstrap.java', 'OriginalExerdOracle.java', 'OriginalDatabaseFixture.java', 'OriginalTermOracle.java')]
    # Cache compilation by exact source/vendor hashes and installed dependency
    # metadata. Each verification still starts a fresh JVM and reads its input.
    compile_inputs = {'sources': {p: sha256(Path(p)) for p in sources},
                      'vendorJars': {p.name: sha256(p) for p in extracted},
                      'eclipseDependencies': {p.name: [p.stat().st_size, p.stat().st_mtime_ns] for p in sorted(plugins.glob('*.jar'))}}
    stamp = WORK / 'classes/build-stamp.json'
    fingerprint = json.dumps(compile_inputs, sort_keys=True)
    if not stamp.exists() or stamp.read_text() != fingerprint or not (WORK / 'classes/OriginalDatabaseFixture.class').exists():
        run(['javac', '-proc:none', '-cp', classpath, '-d', str(WORK / 'classes'), *sources])
        stamp.write_text(fingerprint)
    if args.generate_fixtures:
        if args.input is not None or args.save or args.xml or args.describe:
            parser.error('--generate-fixtures is independent of input/read/save options')
        fixture_dir = args.generate_fixtures.resolve()
        if not fixture_dir.is_relative_to(ROOT / '.analysis') or fixture_dir.exists():
            parser.error('Factory fixture directory must be new and below .analysis')
        os.environ['ECLIPSE_PLUGINS'] = str(plugins)
        os.environ['ORACLE_JARS'] = os.pathsep.join(map(str, extracted))
        os.environ['ORACLE_MAIN_CLASS'] = 'OriginalDatabaseFixture'
        run(['java', '-cp', str(WORK / 'classes'), 'OracleBootstrap', str(fixture_dir)])
        generated = sorted(fixture_dir.glob('*.exerd'))
        provenance = {'kind': 'original-factory-generated', 'samples': {p.name: sha256(p) for p in generated}, 'databaseVersion': 'original factory default null; no inferred DB version', 'liveDatabaseVerified': False, 'uiVerified': False, 'headlessReadbackVerified': False, 'vendorJars': {p.name: sha256(p) for p in extracted}}
        (fixture_dir / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        return
    before = sha256(source)
    os.environ['ORACLE_MAIN_CLASS'] = 'OriginalTermOracle' if args.term else 'OriginalExerdOracle'
    load_source = source
    if args.xml:
        data = source.read_bytes()
        qualifier_size = struct.unpack_from('>I', data, 22)[0]
        start = 34 + qualifier_size
        xml_size = struct.unpack_from('>Q', data, 26 + qualifier_size)[0]
        name_size, extra_size = struct.unpack_from('<HH', data, start + 26)
        payload = data[start + 30 + name_size + extra_size:start + xml_size - 16]
        xml = zlib.decompress(payload, -15)
        load_source = WORK / 'output' / (source.name + '.xml')
        load_source.write_bytes(xml)
        os.environ['ORACLE_XML'] = '1'
    else:
        os.environ.pop('ORACLE_XML', None)
    invocation = ['java', '-cp', str(WORK / 'classes'), 'OracleBootstrap', str(load_source)]
    if args.save:
        invocation.append(str(dest))
    os.environ['ECLIPSE_PLUGINS'] = str(plugins)
    os.environ['ORACLE_JARS'] = os.pathsep.join(map(str, extracted))
    if args.describe:
        os.environ['ORACLE_DESCRIBE'] = '1'
    else:
        os.environ.pop('ORACLE_DESCRIBE', None)
    if args.transform:
        os.environ['ORACLE_TRANSFORM'] = '1'
    else:
        os.environ.pop('ORACLE_TRANSFORM', None)
    os.environ['ORACLE_SELECT_UUIDS'] = ','.join(args.select_uuid)
    representation = 'term-xml' if args.term else 'original-transform-then-xml' if args.transform else ('xml' if args.xml else 'binary')
    stem = source.name + ('.transformed' if args.transform else '') + ('.xml' if args.xml else '') + ('.described' if args.describe else '')
    report_path = WORK / 'output' / (stem + '.report.json')
    try:
        log = run(invocation)
    except RuntimeError as error:
        report_path.write_text(json.dumps({'input': str(source), 'status': 'failed',
            'headlessOriginalReaderVerified': False, 'representation': representation,
            'contentDescriberRequired': args.describe, 'error': str(error),
            'inputSha256Before': before, 'inputSha256After': sha256(source)}, indent=2) + '\n')
        raise
    after = sha256(source)
    if before != after:
        raise RuntimeError('Input SHA-256 changed')
    report = {'status': 'passed', 'contentDescriberRequired': args.describe, 'input': str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else str(source),
              'inputSha256Before': before, 'inputSha256After': after,
              'originalSerializer': ('com.tomato.exerd.term.model_' if args.term else 'com.tomato.exerd.model_') + '3.3.56.20260820-1610',
              'eclipsePlugins': str(plugins),
              'vendorJars': {p.name: sha256(p) for p in extracted},
              'uiReopenVerified': False, 'headlessOriginalReaderVerified': True,
              'saved': str(dest) if args.save else None}
    report['representation'] = representation
    if args.term:
        report['readerScope'] = 'Original generated TermModelPackage/EFactory with EMF XMLResourceImpl, matching FileDocument resource type; not GUI provider execution'
    (WORK / 'output' / (stem + '.log')).write_text(log)
    (WORK / 'output' / (stem + '.report.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
