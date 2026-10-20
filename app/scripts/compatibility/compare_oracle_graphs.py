#!/usr/bin/env python3
"""Compare UUID-addressed persisted feature dumps from the original reader.

Writes private details below .analysis/oracle/output and prints counts only.
This is not UI, rendering, derived-property or DB integration verification.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('before', type=Path)
    p.add_argument('after', type=Path)
    p.add_argument('--report', type=Path, default=ROOT / '.analysis/oracle/output/graph-comparison.json')
    p.add_argument('--expected-changes', type=int, default=0)
    args = p.parse_args()
    before, after = (json.loads(f.read_text()) for f in (args.before, args.after))
    changes = []
    missing = object()
    for uuid in sorted(before.keys() | after.keys()):
        if uuid not in before or uuid not in after:
            changes.append({'uuid': uuid, 'kind': 'added' if uuid in after else 'removed'})
            continue
        a, b = before[uuid], after[uuid]
        if a['type'] != b['type']:
            changes.append({'uuid': uuid, 'feature': '$type', 'before': a['type'], 'after': b['type']})
        for feature in sorted(a['features'].keys() | b['features'].keys()):
            if a['features'].get(feature, missing) != b['features'].get(feature, missing):
                changes.append({'uuid': uuid, 'feature': feature, 'before': a['features'].get(feature), 'after': b['features'].get(feature), 'beforePresent': feature in a['features'], 'afterPresent': feature in b['features']})
    result = {'beforeObjects': len(before), 'afterObjects': len(after), 'changedFeatures': len(changes), 'changes': changes}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'changes'}))
    raise SystemExit(0 if len(changes) == args.expected_changes else 1)


if __name__ == '__main__':
    main()
