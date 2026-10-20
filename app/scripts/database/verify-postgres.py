#!/usr/bin/env python3
"""Apply generated SQL only to a new disposable, network-isolated PostgreSQL container."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]

def invoke(args, stdin=None, check=True):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, cwd=ROOT)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result

CATALOG = """
WITH ns AS (SELECT oid FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'),
t AS (SELECT * FROM pg_class WHERE relnamespace IN (SELECT oid FROM ns) AND relkind IN ('r','p')),
c AS (SELECT * FROM pg_constraint WHERE conrelid IN (SELECT oid FROM t))
SELECT json_build_object(
 'tables',(SELECT count(*) FROM t),
 'columns',(SELECT count(*) FROM pg_attribute WHERE attrelid IN (SELECT oid FROM t) AND attnum>0 AND NOT attisdropped),
 'primaryKeys',(SELECT count(*) FROM c WHERE contype='p'),
 'foreignKeys',(SELECT count(*) FROM c WHERE contype='f'),
 'uniqueConstraints',(SELECT count(*) FROM c WHERE contype='u'),
 'checks',(SELECT count(*) FROM c WHERE contype='c'),
 'indexesIncludingConstraintIndexes',(SELECT count(*) FROM pg_index WHERE indrelid IN (SELECT oid FROM t))
);
"""

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sql', type=Path)
    parser.add_argument('expected', type=Path, help='Generator summary or fixture expected JSON')
    parser.add_argument('--image', default='postgres:17')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--behavior-fixture', action='store_true', help='Also exercise constraints of the independent native_ddl_fixture model')
    args = parser.parse_args()
    source, expected_path = args.sql.resolve(), args.expected.resolve()
    if not source.is_file() or not expected_path.is_file():
        parser.error('SQL and expected JSON must exist')
    expected_document = json.loads(expected_path.read_text())
    if expected_document.get('complete') is False:
        parser.error('Incomplete SQL requires explicit manual review; this verifier will not execute it')
    expected = expected_document.get('expectedDatabase')
    if expected is None:
        expected = dict(expected_document['statistics'])
        expected['indexesIncludingConstraintIndexes'] = expected.pop('indexes') + expected['primaryKeys'] + expected['uniqueConstraints']
        expected.pop('sequences', None)
    output = args.output or ROOT / '.analysis/database' / ('postgres-' + str(int(time.time())) + '-' + uuid.uuid4().hex[:8])
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.analysis') or output.exists():
        parser.error('Output must be a new directory below .analysis')
    output.mkdir(parents=True)
    name = 'erd-maker-verify-' + uuid.uuid4().hex[:12]
    container_id = None
    report = {'sqlSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'image': args.image, 'container': name, 'expected': expected, 'network': 'none', 'hostPorts': [], 'existingDatabasesTouched': False}
    try:
        container_id = invoke(['docker', 'run', '--detach', '--rm', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=erd_verify', args.image]).stdout.strip()
        for attempt in range(60):
            logs = invoke(['docker', 'logs', name], check=False)
            # The entrypoint briefly starts a temporary server during initdb.
            # Wait for the final server, not that temporary socket.
            initialized = 'PostgreSQL init process complete' in logs.stdout + logs.stderr
            if initialized and invoke(['docker', 'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'erd_verify'], check=False).returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('PostgreSQL startup timed out')
        def query(sql):
            return invoke(['docker', 'exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'erd_verify', '-At'], sql)
        result = query('BEGIN;\n' + source.read_text() + '\nCOMMIT;\n')
        (output / 'apply.log').write_text(result.stdout + result.stderr)
        report['databaseVersion'] = query('SELECT version();').stdout.strip()
        actual = json.loads(query(CATALOG).stdout)
        report['actual'] = actual
        catalog_sql = ROOT / 'app/scripts/database/postgres-catalog.sql'
        if catalog_sql.exists():
            catalog = json.loads(query(catalog_sql.read_text()).stdout)
            (output / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
            report['catalogExported'] = True
        if actual != expected:
            raise RuntimeError('Database catalog counts differ from the generator summary')
        if args.behavior_fixture:
            if expected_document.get('schema') != 'native_ddl_fixture':
                raise RuntimeError('Behavior tests are restricted to the independent fixture')
            seed = "INSERT INTO native_ddl_fixture.new_table(id,code) VALUES (1,'AA'); INSERT INTO native_ddl_fixture.child(id,parent_id,code) VALUES (1,1,'AA');"
            query('BEGIN;' + seed + 'ROLLBACK;')
            behavior = []
            for label, statement, state in [
                ('foreign-key', "INSERT INTO native_ddl_fixture.child(id,parent_id,code) VALUES (2,999,'AA');", '23503'),
                ('check', "INSERT INTO native_ddl_fixture.new_table(id,code) VALUES (-1,'NEG');", '23514'),
                ('unique', "INSERT INTO native_ddl_fixture.new_table(id,code) VALUES (2,'AA');", '23505'),
                ('primary-key-not-null', "INSERT INTO native_ddl_fixture.new_table(id,code) VALUES (NULL,'BB');", '23502'),
            ]:
                result = invoke(['docker', 'exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'erd_verify'], '\\set VERBOSITY sqlstate\nBEGIN;\n' + seed + statement + '\nROLLBACK;\n', check=False)
                if result.returncode == 0 or state not in result.stderr:
                    (output / ('behavior-' + label + '.log')).write_text(result.stdout + result.stderr)
                    raise RuntimeError('Constraint behavior did not match expected SQLSTATE: ' + label)
                behavior.append({'test': label, 'expectedSqlstate': state, 'passed': True})
            report['behavior'] = behavior
        dump = invoke(['docker', 'exec', name, 'pg_dump', '-U', 'postgres', '-d', 'erd_verify', '--schema-only', '--no-owner', '--no-privileges'])
        (output / 'database-schema.sql').write_text(dump.stdout)
        report['passed'] = True
        print(json.dumps({'passed': True, 'databaseVersion': report['databaseVersion'], 'catalog': actual, 'reportDirectory': str(output.relative_to(ROOT))}, ensure_ascii=False))
    except Exception as error:
        report['passed'], report['error'] = False, str(error)
        (output / 'error.log').write_text(str(error))
        print(json.dumps({'passed': False, 'reportDirectory': str(output.relative_to(ROOT)), 'reason': 'See private error.log'}, ensure_ascii=False))
        raise SystemExit(1)
    finally:
        if container_id:
            stopped = invoke(['docker', 'stop', container_id], check=False)
            report['containerRemoved'] = stopped.returncode == 0
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
