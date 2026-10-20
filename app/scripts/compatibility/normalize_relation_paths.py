#!/usr/bin/env python3
"""Give original EMF relation entries stable FK-key identities for deletion comparisons.

Only replaces indexed URI fragment identities; retains list order and all feature values.
Fails on duplicate FK keys instead of merging entries.
"""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path)
    p.add_argument('output', type=Path)
    args = p.parse_args()
    graph = json.loads(args.input.read_text())
    identities = {}
    seen = set()
    for fragment, node in graph.items():
        if node['type'].endswith('#RelationEntry'):
            key = node['features'].get('key', {}).get('ref')
            value = node['features'].get('value', {}).get('ref')
            if key is None or value is None:
                raise ValueError('Incomplete RelationEntry')
            if key in seen:
                raise ValueError('Duplicate relation key')
            seen.add(key)
            identities[fragment] = 'relation-entry:' + key
            identities[value] = 'relation:' + key
    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, dict):
            return {k: identities.get(v, v) if k == 'ref' and isinstance(v, str) else rewrite(v) for k, v in value.items()}
        return value
    result = {identities.get(k, k): rewrite(v) for k, v in graph.items()}
    if len(result) != len(graph):
        raise ValueError('Identity collision')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'objects': len(result), 'relationEntries': len(seen)}))


if __name__ == '__main__':
    main()
