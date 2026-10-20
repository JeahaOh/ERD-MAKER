#!/usr/bin/env python3
"""Execute generated FK fixtures ONLY in fresh network-isolated containers.

Uses local images, no host database, ports, binds, credentials or Docker volumes.
Records exact image IDs, SQL hashes, catalog values and successful/failed behavior.
Stops only the container created by this invocation (--rm cleans ephemeral data).
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import signal
import subprocess
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
IMAGES = {'postgresql': 'postgres:17', 'mysql': 'mysql:8.4', 'mariadb': 'mariadb:11.4', 'oracle': 'container-registry.oracle.com/database/free:latest-lite'}


def command(args, sql=None, timeout=60):
    return subprocess.run(args, input=sql, text=True, capture_output=True, timeout=timeout, cwd=ROOT)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(dialect, fixtures, source, output, sqlplus_kit=None):
    image = IMAGES[dialect]
    report = {'dialect': dialect, 'image': image, 'passed': False, 'checks': [], 'cleanup': False, 'existingDatabasesTouched': False}
    container = ''
    network = ''
    def query(sql, timeout=45):
        if dialect == 'postgresql':
            args = ['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'erd_verify']
            sql = '\\set VERBOSITY sqlstate\n' + sql
        elif dialect == 'oracle':
            args = ['sqlplus', '-s', '/', 'as', 'sysdba']
            sql = ('WHENEVER OSERROR EXIT FAILURE ROLLBACK\nWHENEVER SQLERROR EXIT FAILURE ROLLBACK\n'
                   'SET HEADING OFF FEEDBACK OFF PAGESIZE 0 LINESIZE 32767 TRIMSPOOL ON VERIFY OFF\n'
                   'ALTER SESSION SET CONTAINER=FREEPDB1;\n' + sql + '\nEXIT SUCCESS\n')
        else:
            args = ['mysql' if dialect == 'mysql' else 'mariadb', '--protocol=tcp', '-h127.0.0.1', '-uroot', '--batch', '--raw', '--skip-column-names']
        return command(['docker', 'exec', '-i', container, *args], sql, timeout)

    def check(label, sql, expected=None, error=None):
        result = query(sql)
        entry = {'name': label, 'sql': sql, 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'passed': False}
        report['checks'].append(entry)
        combined = result.stdout + result.stderr
        if error:
            entry['expectedError'] = error
            if result.returncode == 0 or not re.search(error, combined):
                raise AssertionError(f'{label}: expected error {error}; got {combined}')
        else:
            if result.returncode or re.search(r'(^|\n)(ORA-|SP2-|ERROR )', combined):
                raise AssertionError(f'{label}: {combined}')
            if expected is not None:
                actual = [line.strip()[11:] for line in result.stdout.splitlines() if line.strip().startswith('ERD_RESULT:')]
                entry['expected'], entry['actual'] = expected, actual
                if actual != expected:
                    raise AssertionError(f'{label}: expected {expected}, got {actual}')
        entry['passed'] = True

    def scalar(expression, source=''):
        if dialect in ('mysql', 'mariadb'):
            value = f"CONCAT('ERD_RESULT:',{expression})"
        else:
            value = f"'ERD_RESULT:' || ({expression})"
        return f'SELECT {value} {source or ("FROM dual" if dialect == "oracle" else "")};'

    try:
        if not fixtures:
            raise ValueError('No fixtures for the selected database')
        inspected = command(['docker', 'image', 'inspect', image])
        if inspected.returncode:
            raise RuntimeError('Local image unavailable; explicitly pull the image first')
        info = json.loads(inspected.stdout)[0]
        report.update(imageId=info['Id'], repoDigests=info.get('RepoDigests', []), architecture=info['Architecture'])
        name = f'erd-maker-fk-{dialect}-{uuid.uuid4().hex[:10]}'
        if dialect == 'oracle':
            # Oracle IPC requires a non-loopback address. An isolated internal bridge
            # supplies one without an external route or a host bridge address.
            created = command(['docker', 'network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', name])
            if created.returncode:
                raise RuntimeError(created.stderr)
            network = created.stdout.strip()
            net = json.loads(command(['docker', 'network', 'inspect', network]).stdout)[0]
            if not net['Internal'] or net['Options'].get('com.docker.network.bridge.gateway_mode_ipv4') != 'isolated':
                raise AssertionError('Oracle test network must be internal and isolated')
            report['testNetwork'] = {'id': network, 'internal': net['Internal'], 'options': net['Options']}
        args = ['docker', 'run', '-d', '--rm', '--name', name, '--network', network or 'none', '--cpus', '2', '--pids-limit', '512']
        if dialect == 'postgresql':
            args += ['--memory', '512m', '--tmpfs', '/var/lib/postgresql/data:rw,size=384m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=erd_verify']
        elif dialect == 'oracle':
            # The official lite image contains its initialized database; no mount or host credentials.
            args += ['--memory', '3g', '--shm-size', '1g']
        else:
            args += ['--memory', '1g', '--tmpfs', '/var/lib/mysql:rw,size=768m', '-e', 'MYSQL_ALLOW_EMPTY_PASSWORD=1' if dialect == 'mysql' else 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1']
        launched = command([*args, image])
        if launched.returncode:
            raise RuntimeError(launched.stderr)
        container = launched.stdout.strip()
        inspection = json.loads(command(['docker', 'inspect', container]).stdout)[0]
        host = inspection['HostConfig']
        if host['NetworkMode'] != (network or 'none') or host.get('PortBindings') or host.get('Binds') or inspection.get('Mounts') and any(m['Type'] != 'tmpfs' for m in inspection['Mounts']):
            raise AssertionError('Isolation mismatch: requires no network/ports/host mounts/volumes')
        report.update(containerId=container, isolation={'network': host['NetworkMode'], 'ports': host.get('PortBindings'), 'binds': host.get('Binds'), 'memory': host['Memory'], 'mounts': inspection.get('Mounts', [])})
        print(f'{dialect}: isolated container started', flush=True)
        deadline = time.monotonic() + (480 if dialect == 'oracle' else 180)
        while time.monotonic() < deadline:
            # A temporary PG initdb server must not accept test DDL.
            if dialect == 'postgresql':
                logs = command(['docker', 'logs', container])
                initialized = 'PostgreSQL init process complete' in logs.stdout + logs.stderr
            else:
                initialized = True
            readiness = scalar('open_mode', "FROM v$pdbs WHERE name='FREEPDB1'") if dialect == 'oracle' else scalar('1')
            ready = query(readiness, timeout=15)
            ready_marker = 'ERD_RESULT:READ WRITE' if dialect == 'oracle' else 'ERD_RESULT:1'
            if initialized and ready.returncode == 0 and ready_marker in ready.stdout:
                break
            state_result = command(['docker', 'inspect', container])
            if state_result.returncode:
                raise RuntimeError('Test container disappeared during initialization')
            state = json.loads(state_result.stdout)[0]['State']
            if not state['Running'] or state.get('Health', {}).get('Status') == 'unhealthy':
                raise RuntimeError('Container exited during initialization')
            time.sleep(2)
        else:
            raise TimeoutError('Database startup timed out')
        version = {'postgresql': 'version()', 'mysql': '@@version', 'mariadb': '@@version', 'oracle': 'banner_full'}[dialect]
        version_result = query(scalar(version, "FROM v$version WHERE ROWNUM=1" if dialect == 'oracle' else ''))
        report['versionReadback'] = {'exitCode': version_result.returncode, 'stdout': version_result.stdout, 'stderr': version_result.stderr}
        if version_result.returncode or 'ERD_RESULT:' not in version_result.stdout:
            raise AssertionError('Version readback failed')
        report['databaseVersion'] = version_result.stdout.strip()
        if dialect == 'oracle' and sqlplus_kit:
            kit = json.loads((sqlplus_kit.parent / 'kit.json').read_text())
            if kit['schema'] != 'SYSTEM' or kit['expectedMajor'] != 23 or digest(sqlplus_kit) != kit['sqlSha256']:
                raise ValueError('Local kit proof requires a hashed SYSTEM/major23 kit; company scripts are never executed here')
            check('sqlplus-acceptance-kit', 'ALTER SESSION SET CURRENT_SCHEMA="SYSTEM";\n' + sqlplus_kit.read_text())
            if 'ERD_ORACLE_TEST_PASS' not in report['checks'][-1]['stdout']:
                raise AssertionError('SQLPlus acceptance marker missing')
            report['sqlplusKitProof'] = {'sha256': digest(sqlplus_kit), 'assertions': kit['assertions'], 'actualMajor': 23, 'oracle19Verified': False}
        for case in fixtures:
            key, schema_name = case['id'], case['schema']
            if not all(re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', case[k]) for k in ('schema', 'parent', 'child', 'constraint')):
                raise ValueError('Fixture identifiers must be simple test names')
            sql_path, model_path = source / case['sql'], source / case['model']
            if not sql_path.resolve().is_relative_to(source) or not model_path.resolve().is_relative_to(source):
                raise ValueError('Fixture path escapes input directory')
            if not case['complete'] or digest(sql_path) != case['sqlSha256'] or digest(model_path) != case['modelSha256']:
                raise AssertionError('Fixture incomplete or hash mismatch')
            quoted = lambda s: ('`' + s + '`') if dialect in ('mysql', 'mariadb') else ('"' + s + '"')
            p = quoted(schema_name) + '.' + quoted(case['parent'])
            c = quoted(schema_name) + '.' + quoted(case['child'])
            col = quoted('parent_id')
            fk_error = '23503' if dialect == 'postgresql' else r'ORA-02291' if dialect == 'oracle' else r'ERROR 1452 \(23000\)'
            parent_error = '23503' if dialect == 'postgresql' else r'ORA-02292' if dialect == 'oracle' else r'ERROR 1451 \(23000\)'
            ddl = sql_path.read_text()
            if case['kind'] == 'novalidate':
                # Exercise existing invalid rows: add the exact generated FK after seeding tables.
                matches = list(re.finditer(r'^ALTER TABLE .* FOREIGN KEY .*;$', ddl, re.M))
                if len(matches) != 1:
                    raise AssertionError('Expected exactly one generated FK statement')
                match = matches[0]
                check(key + ':tables-before-fk', ddl[:match.start()] + ddl[match.end():])
                check(key + ':seed-existing-orphan', f'INSERT INTO {c} VALUES (90,900);\nCOMMIT;')
                check(key + ':add-unvalidated-fk', match[0])
            else:
                check(key + ':generated-ddl', ddl)

            action = case['action']
            delete = action if case['operation'] == 'delete' else 'NO ACTION'
            update = action if case['operation'] == 'update' else 'NO ACTION'
            if dialect == 'postgresql':
                codes = {'NO ACTION': 'a', 'RESTRICT': 'r', 'CASCADE': 'c', 'SET NULL': 'n', 'SET DEFAULT': 'd'}
                defer = case['kind'].startswith('deferred')
                expression = "confdeltype::text || '|' || confupdtype::text || '|' || condeferrable::text || '|' || condeferred::text || '|' || convalidated::text || '|' || confmatchtype::text"
                expected = '|'.join([codes[delete], codes[update], str(defer).lower(), str(defer).lower(), str(case['kind'] != 'novalidate').lower(), 'f' if case['kind'] == 'match_full' else 's'])
                catalog = scalar(expression, f"FROM pg_constraint WHERE conname='{case['constraint']}' AND connamespace='{schema_name}'::regnamespace")
            elif dialect == 'oracle':
                defer = case['kind'] == 'deferred'
                expression = "delete_rule || '|' || status || '|' || validated || '|' || deferrable || '|' || deferred"
                expected = '|'.join([delete, 'DISABLED' if case['kind'] == 'disabled' else 'ENABLED', 'NOT VALIDATED' if case['kind'] in ('disabled', 'novalidate') else 'VALIDATED', 'DEFERRABLE' if defer else 'NOT DEFERRABLE', 'DEFERRED' if defer else 'IMMEDIATE'])
                catalog = scalar(expression, f"FROM all_constraints WHERE owner='{schema_name}' AND constraint_name='{case['constraint']}' AND constraint_type='R'")
            else:
                # Normalize only InnoDB's semantically equivalent NO ACTION/RESTRICT.
                normalize = lambda field: f"IF({field}='NO ACTION','RESTRICT',{field})"
                expression = f"CONCAT({normalize('DELETE_RULE')},'|',{normalize('UPDATE_RULE')})"
                expected = '|'.join('RESTRICT' if v == 'NO ACTION' else v for v in (delete, update))
                catalog = scalar(expression, f"FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='{schema_name}' AND CONSTRAINT_NAME='{case['constraint']}'")
            check(key + ':catalog', catalog, [expected])
            if case['kind'] == 'disabled':
                check(key + ':disabled-allows-orphan', f'INSERT INTO {c} VALUES (1,999);\nCOMMIT;\n' + scalar('COUNT(*)', f'FROM {c}'), ['1'])
                check(key + ':enable-validate-rejects-orphan', f'ALTER TABLE {c} ENABLE VALIDATE CONSTRAINT {quoted(case["constraint"])};', error=r'ORA-02298')
                continue
            if case['kind'] == 'novalidate':
                check(key + ':existing-orphan-preserved', scalar('COUNT(*)', f'FROM {c} WHERE {col}=900'), ['1'])
                check(key + ':new-orphan-rejected', f'INSERT INTO {c} VALUES (91,901);', error=fk_error)
                check(key + ':validate-rejects-existing-orphan', f'ALTER TABLE {c} {"VALIDATE CONSTRAINT" if dialect == "postgresql" else "ENABLE VALIDATE CONSTRAINT"} {quoted(case["constraint"])};', error='23503' if dialect == 'postgresql' else r'ORA-02298')
                continue
            if case['kind'] in ('match_full', 'match_simple'):
                check(key + ':composite-seed', f'INSERT INTO {p} VALUES (1,10);\nINSERT INTO {c} VALUES (1,1,10);\nINSERT INTO {c} VALUES (2,NULL,NULL);')
                check(key + ':composite-orphan', f'INSERT INTO {c} VALUES (3,9,90);', error=fk_error)
                check(key + ':mixed-null', f'INSERT INTO {c} VALUES (4,1,NULL);', error=fk_error if case['kind'] == 'match_full' else None)
                continue
            if case['kind'] == 'deferred':
                begin = 'BEGIN;\n' if dialect == 'postgresql' else ''
                check(key + ':deferred-repaired-before-commit', begin + f'INSERT INTO {c} VALUES (1,999);\nINSERT INTO {p} VALUES (999);\nCOMMIT;\n' + scalar('COUNT(*)', f'FROM {c}'), ['1'])
                check(key + ':deferred-unresolved-at-commit', begin + f'INSERT INTO {c} VALUES (2,998);\nCOMMIT;', error=fk_error)
                check(key + ':failed-transaction-rolled-back', scalar('COUNT(*)', f'FROM {c}'), ['1'])
                continue
            check(key + ':seed', f'INSERT INTO {p} VALUES (0);\nINSERT INTO {p} VALUES (1);\nINSERT INTO {c} VALUES (1,1);\nCOMMIT;')
            # A deferred RESTRICT FK checks parent deletion immediately; new orphan checks wait for commit.
            if case['kind'] != 'deferred_restrict':
                check(key + ':reject-orphan', f'INSERT INTO {c} VALUES (2,999);\nCOMMIT;', error=fk_error)
            statement = f'DELETE FROM {p} WHERE {quoted("id")}=1;' if case['operation'] == 'delete' else f'UPDATE {p} SET {quoted("id")}=2 WHERE {quoted("id")}=1;'
            if action in ('NO ACTION', 'RESTRICT'):
                begin = 'BEGIN;\n' if case['kind'] == 'deferred_restrict' else ''
                check(key + ':restrict-parent', begin + statement, error=parent_error)
                check(key + ':parent-unchanged', scalar('COUNT(*)', f'FROM {p} WHERE {quoted("id")}=1'), ['1'])
            else:
                check(key + ':parent-action', statement + '\nCOMMIT;')
                where = '' if action == 'CASCADE' and case['operation'] == 'delete' else f' WHERE {col} IS NULL' if action == 'SET NULL' else f' WHERE {col}={0 if action == "SET DEFAULT" else 2}'
                check(key + ':child-readback', scalar('COUNT(*)', f'FROM {c}' + where), ['0' if action == 'CASCADE' and case['operation'] == 'delete' else '1'])
            print(f'{dialect}: {key} {case["kind"]} {case["operation"]} {action} passed', flush=True)
        for case in fixtures:
            if digest(source / case['sql']) != case['sqlSha256'] or digest(source / case['model']) != case['modelSha256']:
                raise AssertionError('Input changed during verification')
        report['fixtureCount'] = len(fixtures)
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        print(f'{dialect}: FAILED {error}', flush=True)
    finally:
        if container:
            stopped = command(['docker', 'stop', '--timeout', '20', container], timeout=60)
            report['cleanup'] = stopped.returncode == 0
        if network:
            removed = command(['docker', 'network', 'rm', network])
            report['networkCleanup'] = removed.returncode == 0
            report['cleanup'] = report['cleanup'] and report['networkCleanup']
        report['passed'] = report['passed'] and report['cleanup']
        (output / (dialect + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--dialect', choices=list(IMAGES), action='append')
    parser.add_argument('--sqlplus-kit', type=Path, help='Prove a local major23/SYSTEM acceptance kit inside the fresh Oracle container')
    args = parser.parse_args()
    source, output = args.fixtures.resolve(), args.out.resolve()
    sqlplus_kit = args.sqlplus_kit.resolve() if args.sqlplus_kit else None
    if sqlplus_kit and not sqlplus_kit.is_relative_to(ROOT / '.analysis'):
        parser.error('--sqlplus-kit must be below .analysis')
    if not source.is_relative_to(ROOT / '.analysis') or not output.is_relative_to(ROOT / '.analysis') or output == ROOT / '.analysis' or output.exists():
        parser.error('Inputs must be below .analysis; output must be a NEW directory below .analysis')
    manifest_path = source / 'manifest.json'
    manifest_hash = digest(manifest_path)
    cases = json.loads(manifest_path.read_text())['cases']
    output.mkdir(parents=True)
    def interrupted(_signum, _frame):
        raise RuntimeError('Interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    reports = [verify(dialect, [c for c in cases if c['dialect'] == dialect], source, output, sqlplus_kit) for dialect in (args.dialect or list(IMAGES))]
    passed = all(r['passed'] for r in reports) and manifest_hash == digest(manifest_path)
    summary = {'passed': passed, 'manifestSha256': manifest_hash, 'databases': [{'dialect': r['dialect'], 'passed': r['passed'], 'checks': len(r['checks']), 'fixtures': r.get('fixtureCount'), 'version': r.get('databaseVersion'), 'cleanup': r['cleanup']} for r in reports]}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary), flush=True)
    raise SystemExit(0 if passed else 1)
