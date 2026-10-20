#!/usr/bin/env python3
"""Execute the unmodified original Oracle ForwardRequest/DDLGenerator API locally.

Requires original_oracle.py and prepare_original_ui.py preparation. This is a
separate headless original-generator oracle, not GUI or real-server validation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / '.analysis/oracle'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path, help='New SQL file below .analysis')
    parser.add_argument('--enterprise', action='store_true', help='Use original SQL Server/Db2/CUBRID context/configuration APIs')
    parser.add_argument('--plugins', type=Path, default=Path(os.environ.get('ECLIPSE_PLUGINS', '/Applications/DBeaver.app/Contents/Eclipse/plugins')))
    args = parser.parse_args()
    source, output = args.input.resolve(), args.output.resolve()
    if not source.is_file() or output.exists() or not output.is_relative_to(ROOT / '.analysis'):
        parser.error('Input must exist; output must be a new file under .analysis')
    ui = WORK / 'ui/plugins'
    if not (WORK / 'classes/OriginalExerdOracle.class').is_file() or not ui.is_dir():
        parser.error('Run original_oracle.py INPUT and prepare_original_ui.py first')
    jars = sorted(ui.glob('*.jar')) + sorted(args.plugins.glob('*.jar'))
    jars += sorted((WORK / 'lib').glob('*-jdom.jar')) + sorted((WORK / 'lib').glob('*-jaxen.jar'))
    main_class = 'OriginalEnterpriseDdl' if args.enterprise else 'OriginalOracleDdl'
    sources = [Path(__file__).with_name(main_class + '.java')]
    cp = os.pathsep.join(map(str, [WORK / 'classes', *jars]))
    subprocess.run(['javac', '-proc:none', '-cp', cp, '-d', str(WORK / 'classes'), *map(str, sources)], cwd=ROOT, check=True)
    env = os.environ.copy()
    env['ORACLE_MAIN_CLASS'] = main_class
    env['ORACLE_JARS'] = os.pathsep.join(map(str, jars))
    env['ECLIPSE_PLUGINS'] = str(args.plugins.resolve())
    before = digest(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    run = subprocess.run(['java', '-cp', str(WORK / 'classes'), 'OracleBootstrap', str(source), str(output)], cwd=ROOT, env=env, capture_output=True, text=True)
    output.with_suffix('.log').write_text(run.stdout + run.stderr)
    if run.returncode:
        raise RuntimeError(f'Original generator failed: exit {run.returncode}; see {output.with_suffix(".log")}')
    if digest(source) != before:
        raise RuntimeError('Input changed during original-generator execution')
    report = {'kind': 'unmodified-original-enterprise-generator' if args.enterprise else 'unmodified-original-oracle-generator', 'inputSha256': before,
              'outputSha256': digest(output), 'gui': False, 'serverExecution': False,
              'summary': json.loads(run.stdout.strip().splitlines()[-1]),
              'options': {'createTables': True, 'createPkUkIndexes': True, 'createNonUniqueIndexes': True,
                          'addPkFkUkCheck': True, 'tableIndexPhysicalProperties': True,
                          'constraintState': True, 'quoteNames': True, 'ownerPrefix': True,
                          'comments': 'persisted comments only'},
              'sources': {p.name: digest(p) for p in sources},
              'jars': {str(p): digest(p) for p in jars}}
    if args.enterprise:
        report['options'] = {'configurationFieldsSetTrue': report['summary']['enabledOptions'],
                             'quoteNames': True, 'ownerPrefix': True, 'userDefineProperties': ['COMMENT'],
                             'sourceProductSelectsOriginalGenerator': True}
    output.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'jars'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
