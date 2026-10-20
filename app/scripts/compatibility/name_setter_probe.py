#!/usr/bin/env python3
"""After original_oracle.py prepares local jars, test unmodified original name setters."""
from pathlib import Path
import os
import json
import subprocess
from original_oracle import ROOT, WORK


def main():
    plugins = Path(os.environ.get('ECLIPSE_PLUGINS', '/Applications/DBeaver.app/Contents/Eclipse/plugins'))
    jars = sorted((WORK / 'lib').glob('*.jar'))
    if not jars:
        raise SystemExit('Run original_oracle.py with an input file first to prepare vendor jars')
    classpath = os.pathsep.join(map(str, jars + sorted(plugins.glob('*.jar'))))
    sources = [ROOT / 'app/scripts/compatibility' / n for n in ('OracleBootstrap.java', 'OriginalNameProbe.java')]
    subprocess.run(['javac', '-cp', classpath, '-d', str(WORK / 'classes'), *map(str, sources)], check=True, cwd=ROOT)
    env = dict(os.environ, ECLIPSE_PLUGINS=str(plugins), ORACLE_JARS=os.pathsep.join(map(str, jars)), ORACLE_MAIN_CLASS='OriginalNameProbe')
    p = subprocess.run(['java', '-cp', str(WORK / 'classes'), 'OracleBootstrap'], capture_output=True, text=True, env=env, cwd=ROOT)
    (WORK / 'output/name-setter-probe.jsonl').write_text(p.stdout)
    (WORK / 'output/name-setter-probe.stderr.log').write_text(p.stderr)
    p.check_returncode()
    results = [json.loads(line) for line in p.stdout.splitlines() if line]
    print(json.dumps({'cases': len(results), 'passed': len(results) == 6, 'scope': 'original model setters; UI naming policy audited separately'}))


if __name__ == '__main__':
    main()
