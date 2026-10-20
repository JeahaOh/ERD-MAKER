#!/usr/bin/env python3
"""Observe local eXERD schemas; never execute or change the reference product.

Full compatibility metadata is local analysis output, not a bundled product schema.
The tracked evidence contains counts, hashes, paths and unknowns only.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
XSI = '{http://www.w3.org/2001/XMLSchema-instance}type'
PRIMITIVES = {'EBoolean': 'BOOLEAN', 'EByte': 'BYTE', 'EChar': 'CHAR',
              'EDouble': 'DOUBLE', 'EFloat': 'FLOAT', 'EInt': 'INT',
              'ELong': 'LONG', 'EShort': 'SHORT', 'EString': 'STRING'}

def short_type(value):
    return value.split()[-1] if value else ''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='3.3.56')
    parser.add_argument('--oracle', type=Path, help='Optional local generated-runtime metamodel JSON for independent ID comparison')
    parser.add_argument('--write-runtime', action='store_true', help='Emit minimal independently observed compatibility facts into app source')
    args = parser.parse_args()
    ref = ROOT / '.analysis/ref' / args.version
    if not ref.is_dir():
        raise SystemExit('Run inventory.py first; missing local extracted reference directory')
    packages, by_file, by_bundle = [], {}, {}
    for path in sorted(ref.rglob('*.ecore')):
        relative = path.relative_to(ref)
        if any(part in ('history', 'diagram', 'temp', 'debug') for part in relative.parts):
            continue
        tree = ET.parse(path).getroot()
        if not tree.get('nsURI'):
            continue
        package = {'namespaceURI': tree.get('nsURI'), 'name': tree.get('name'),
                   'prefix': tree.get('nsPrefix'), 'source': str(path.relative_to(ROOT)),
                   'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                   'classes': [], 'enums': [], 'dataTypes': []}
        for cid, node in enumerate(tree.findall('eClassifiers')):
            kind = node.get(XSI, '').split(':')[-1]
            common = {'name': node.get('name'), 'id': cid}
            if kind == 'EClass':
                cls = {**common, 'abstract': node.get('abstract') == 'true',
                       'superTypes': node.get('eSuperTypes', '').split(), 'declaredFeatures': []}
                for fid, feature in enumerate(node.findall('eStructuralFeatures')):
                    fkind = feature.get(XSI, '').split(':')[-1]
                    typ = short_type(feature.get('eType', ''))
                    if not typ:
                        # Unbounded generic attributes/references use EMF's erased default type.
                        typ = 'http://www.eclipse.org/emf/2002/Ecore#//' + ('EObject' if fkind == 'EReference' else 'EJavaObject')
                    many = feature.get('upperBound', '1') != '1'
                    scalar = 'EOBJECT' if fkind == 'EReference' else PRIMITIVES.get(typ.split('#//')[-1], 'DATA')
                    cls['declaredFeatures'].append({
                        'name': feature.get('name'), 'declaredIndex': fid,
                        'kind': ('EOBJECT_LIST' if fkind == 'EReference' else 'DATA_LIST') if many else scalar, 'ecoreKind': fkind,
                        'type': typ, 'many': many, 'lower': int(feature.get('lowerBound', '0')),
                        'upper': int(feature.get('upperBound', '1')),
                        'containment': feature.get('containment', 'false') == 'true',
                        'resolveProxies': feature.get('resolveProxies', 'true') == 'true',
                        'defaultValueLiteral': feature.get('defaultValueLiteral'),
                        **{flag: feature.get(flag, 'false') == 'true' for flag in
                           ('transient', 'volatile', 'derived', 'unsettable')},
                        'changeable': feature.get('changeable', 'true') == 'true',
                        'ordered': feature.get('ordered', 'true') == 'true',
                        'unique': feature.get('unique', 'true') == 'true',
                        'eOpposite': feature.get('eOpposite'),
                        'declaredIn': package['namespaceURI'] + '#//' + cls['name']})
                package['classes'].append(cls)
            elif kind == 'EEnum':
                package['enums'].append({**common, 'literals': [
                    {'name': literal.get('name'), 'literal': literal.get('literal', literal.get('name')),
                     'value': int(literal.get('value', '0'))} for literal in node.findall('eLiterals')]})
            else:
                package['dataTypes'].append({**common, 'instanceClassName': node.get('instanceClassName'),
                                            'serializable': node.get('serializable', 'true') == 'true'})
        packages.append(package)
        by_file[str(path.resolve())] = package
        bundle = re.sub(r'_\d.*$', '', relative.parts[0])
        by_bundle[(bundle, '/'.join(relative.parts[1:]))] = package

    unresolved = []
    def resolve_package(package, target):
        if not target:
            return package
        if target.startswith('http:') or target.startswith('https:'):
            return next((p for p in packages if p['namespaceURI'] == target), None)
        match = re.match(r'platform:/plugin/([^/]+)/(.*)', target)
        if match:
            return by_bundle.get((match.group(1), match.group(2)))
        source = ROOT / package['source']
        candidate = str((source.parent / target).resolve())
        if candidate in by_file:
            return by_file[candidate]
        # Distributed ecores use unversioned Eclipse bundle directory names.
        normalized = re.sub(r'_\d[^/]*(?=/)', '', candidate)
        return next((p for path, p in by_file.items()
                     if re.sub(r'_\d[^/]*(?=/)', '', path) == normalized), None)

    def flatten(package, cls, active=None):
        if 'features' in cls:
            return cls['features']
        active = set() if active is None else active
        key = (package['namespaceURI'], cls['name'])
        if key in active:
            raise ValueError(f'Cyclic inheritance: {key}')
        active.add(key)
        features, seen = [], set()
        for refname in cls['superTypes']:
            target, _, classname = refname.partition('#//')
            parent_package = resolve_package(package, target)
            parent = next((c for c in parent_package['classes'] if c['name'] == classname), None) if parent_package else None
            if parent is None:
                unresolved.append({'class': cls['name'], 'source': package['source'], 'reference': refname})
                continue
            for f in flatten(parent_package, parent, active):
                identity = (f['declaredIn'], f['name'])
                if identity not in seen:
                    seen.add(identity)
                    features.append({k: v for k, v in f.items() if k != 'id'})
        for f in cls['declaredFeatures']:
            features.append(dict(f))
        cls['features'] = [{**f, 'id': i} for i, f in enumerate(features)]
        active.remove(key)
        return cls['features']

    for package in packages:
        for cls in package['classes']:
            flatten(package, cls)
    topics, commands = [], []
    for path in sorted(ref.rglob('*.xml')):
        if path.name == 'plugin.xml' or '/nl/ko/toc/' in str(path):
            try:
                root = ET.parse(path).getroot()
            except ET.ParseError:
                continue
            for node in root.iter():
                if node.tag == 'topic':
                    topics.append({'label': node.get('label'), 'href': node.get('href'),
                                   'source': str(path.relative_to(ROOT))})
                elif node.tag == 'command' and node.get('id'):
                    commands.append({'id': node.get('id'), 'name': node.get('name'),
                                     'source': str(path.relative_to(ROOT))})
    out = ROOT / '.analysis/spec'
    out.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 1, 'version': args.version,
              'featureIdBasis': 'Inherited EAllStructuralFeatures order, unique declaring class/name, then local declaration order; generated Java constants require independent check.',
              'packages': packages, 'unresolvedSuperTypes': unresolved}
    (out / 'binary-registry.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if args.write_runtime:
        minimal = {'schemaVersion': 1, 'basis': 'Independently observed compatibility metadata; regenerate with catalog-model.py --write-runtime. No vendor executable, annotation or help text.',
                   'packages': [{'namespaceURI': p['namespaceURI'],
                       'enumerations': [{'name': e['name'], 'literals': e['literals']} for e in p['enums']],
                       'customDataTypes': [{k: d[k] for k in ('name', 'instanceClassName')} for d in p['dataTypes']],
                       'classes': [
                       {'name': c['name'], 'id': c['id'], 'features': [
                           {k: f[k] for k in ('name', 'id', 'kind', 'type', 'many', 'containment',
                                             'resolveProxies', 'defaultValueLiteral', 'transient', 'derived', 'unsettable')}
                           for f in c['features']]} for c in p['classes']]} for p in packages]}
        (ROOT / 'app/src/formats/exerd/schema.generated.json').write_text(json.dumps(minimal, ensure_ascii=False, separators=(',', ':')) + '\n')
    (out / 'help-command-catalog.json').write_text(json.dumps({'topics': topics, 'commands': commands}, ensure_ascii=False, indent=2) + '\n')
    if args.oracle:
        oracle = json.loads(args.oracle.read_text())
        checked, missing, mismatches = 0, [], []
        for package in packages:
            for cls in package['classes']:
                key = package['namespaceURI'] + '#' + cls['name']
                runtime = oracle.get(key)
                if runtime is None:
                    missing.append(key)
                    continue
                observed = runtime['features']
                expected = {feature['name']: feature for feature in cls['features']}
                if set(observed) != set(expected):
                    mismatches.append({'class': key, 'field': 'featureNames',
                                       'onlySchema': sorted(set(expected)-set(observed)),
                                       'onlyRuntime': sorted(set(observed)-set(expected))})
                for name in observed.keys() & expected.keys():
                    checked += 1
                    for flag in ('id', 'many', 'transient', 'derived'):
                        if observed[name].get(flag) != expected[name].get(flag):
                            mismatches.append({'class': key, 'feature': name, 'field': flag,
                                               'schema': expected[name].get(flag), 'runtime': observed[name].get(flag)})
                    if observed[name]['type'] != expected[name]['type'].split('#//')[-1]:
                        mismatches.append({'class': key, 'feature': name, 'field': 'type',
                                           'schema': expected[name]['type'], 'runtime': observed[name]['type']})
                    if observed[name].get('defaultValue') != expected[name].get('defaultValueLiteral'):
                        mismatches.append({'class': key, 'feature': name, 'field': 'defaultValueLiteral',
                                           'schema': expected[name].get('defaultValueLiteral'), 'runtime': observed[name].get('defaultValue')})
                    runtime_kind = observed[name]['kind']
                    if runtime_kind.startswith('EOBJECT'):
                        runtime_kind = 'EOBJECT_LIST' if 'LIST' in runtime_kind else 'EOBJECT'
                    if runtime_kind != expected[name]['kind']:
                        mismatches.append({'class': key, 'feature': name, 'field': 'kind',
                                           'schema': expected[name]['kind'], 'runtime': observed[name]['kind']})
        comparison = {'oracle': str(args.oracle), 'oracleSha256': hashlib.sha256(args.oracle.read_bytes()).hexdigest(),
                      'checkedFeatures': checked, 'missingRuntimeClasses': missing, 'mismatches': mismatches,
                      'scope': 'Feature names, inherited IDs, type names, many/transient/derived, explicit default literals and scalar/data/reference-list kinds. Reference containment/proxy sub-kinds normalized; actual getter conversion not tested.'}
        (out / 'generated-schema-comparison.json').write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'checkedFeatures': checked, 'missingRuntimeClasses': len(missing), 'mismatches': len(mismatches)}))
    summary = {'schemaVersion': 1, 'version': args.version, 'ecorePackages': len(packages),
               'classes': sum(len(p['classes']) for p in packages),
               'declaredFeatures': sum(len(c['declaredFeatures']) for p in packages for c in p['classes']),
               'helpTopics': len(topics), 'registeredCommands': len(commands),
               'unresolvedSuperTypes': unresolved,
               'sources': [{k: p[k] for k in ('namespaceURI', 'source', 'sha256')} | {
                   'classes': len(p['classes']), 'enums': len(p['enums']),
                   'declaredFeatures': sum(len(c['declaredFeatures']) for c in p['classes'])} for p in packages]}
    evidence = ROOT / 'docs/research/evidence/model-catalog-summary.json'
    evidence.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k not in ('sources', 'unresolvedSuperTypes')}, ensure_ascii=False))
    print(f'unresolvedSuperTypes={len(unresolved)}; local registry={out.relative_to(ROOT)}/binary-registry.json')

if __name__ == '__main__':
    main()
