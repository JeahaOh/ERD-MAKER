#!/usr/bin/env python3
"""Apply generated MySQL/MariaDB DDL to a new isolated, disposable container.

Only the explicitly supplied SQL/expected files are read. No existing database,
network connection, host port, bind mount or installed application is accessed.
Images must already exist locally; this script never downloads dependencies.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]


def command(args: list[str], *, sql: str | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=sql, capture_output=True, text=True, encoding='utf-8', timeout=timeout, cwd=ROOT)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def json_rows(output: str) -> list[dict]:
    return [json.loads(line) for line in output.splitlines() if line.strip()]


def compare_rows(name: str, expected: list[dict], actual: list[dict]) -> dict:
    if len(expected) != len(actual):
        raise AssertionError(f'{name}: expected {len(expected)} rows, actual {len(actual)}')
    remaining = list(actual)
    for row in expected:
        matches = [i for i, item in enumerate(remaining) if all(key in item and item[key] == value for key, value in row.items())]
        if len(matches) != 1:
            raise AssertionError(f'{name}: expected unique row {row}; actual candidates={remaining}')
        remaining.pop(matches[0])
    return {'rows': len(actual), 'expectedFieldsMatched': True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sql', required=True, type=Path)
    parser.add_argument('--expected', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('Verification interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    sql_path, expected_path, out = args.sql.resolve(), args.expected.resolve(), args.out.resolve()
    if not out.is_relative_to(ROOT / '.analysis') or out == ROOT / '.analysis' or out.exists():
        parser.error('--out must be a NEW directory below .analysis')
    expected = json.loads(expected_path.read_text())
    dialect = expected['dialect']
    if dialect not in ('mysql', 'mariadb'):
        parser.error('dialect must be mysql or mariadb')
    schema = expected['schema']
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', schema):
        parser.error('expected schema must be an explicit simple test schema name')
    image = 'mysql:8.4' if dialect == 'mysql' else 'mariadb:11.4'
    inspected_image = command(['docker', 'image', 'inspect', image])
    if inspected_image.returncode:
        raise RuntimeError(f'Local image unavailable or Docker inaccessible: {inspected_image.stderr}')
    image_info = json.loads(inspected_image.stdout)[0]
    original_hashes = {'sql': digest(sql_path), 'expected': digest(expected_path)}
    out.mkdir(parents=True)
    report: dict = {'dialect': dialect, 'image': image, 'imageId': image_info['Id'], 'repoDigests': image_info.get('RepoDigests', []), 'inputs': original_hashes, 'passed': False, 'behaviorChecks': [], 'cleanup': False}
    container_id = ''
    client = 'mysql' if dialect == 'mysql' else 'mariadb'
    name = f'erd-maker-{dialect}-verify-{uuid.uuid4().hex[:10]}'
    def query(sql: str, *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
        return command(['docker', 'exec', '-i', container_id, client, '--protocol=tcp', '-h127.0.0.1', '-uroot', '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names'], sql=sql, timeout=timeout)
    def rows(sql: str) -> list[dict]:
        result = query(sql)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return json_rows(result.stdout)
    try:
        env = 'MYSQL_ALLOW_EMPTY_PASSWORD=1' if dialect == 'mysql' else 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1'
        launched = command(['docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '1g', '--cpus', '2', '--pids-limit', '256', '--tmpfs', '/var/lib/mysql:rw,nosuid,nodev,size=768m', '-e', env, image])
        if launched.returncode:
            raise RuntimeError(launched.stderr)
        container_id = launched.stdout.strip()
        report['containerId'] = container_id
        print(f'{dialect}: isolated container {container_id[:12]} started', flush=True)
        inspection = json.loads(command(['docker', 'inspect', container_id]).stdout)[0]
        isolation = {'network': inspection['HostConfig']['NetworkMode'], 'ports': inspection['HostConfig'].get('PortBindings'), 'memory': inspection['HostConfig']['Memory'], 'tmpfs': inspection['HostConfig']['Tmpfs'], 'binds': inspection['HostConfig'].get('Binds')}
        if isolation['network'] != 'none' or isolation['ports'] or isolation['binds'] or isolation['memory'] != 1073741824 or '/var/lib/mysql' not in isolation['tmpfs']:
            raise AssertionError('Isolation configuration mismatch')
        report['isolation'] = isolation
        # TCP readiness excludes the temporary --skip-networking initialization server.
        deadline = time.monotonic() + 150
        admin = 'mysqladmin' if dialect == 'mysql' else 'mariadb-admin'
        while time.monotonic() < deadline:
            ready = command(['docker', 'exec', container_id, admin, '--protocol=tcp', '-h127.0.0.1', '-uroot', 'ping'], timeout=10)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise TimeoutError('TCP readiness timed out')
        report['server'] = rows("SELECT JSON_OBJECT('version',@@version,'versionComment',@@version_comment,'sqlMode',@@session.sql_mode)")[0]
        if not report['server']['version'].startswith('8.4.' if dialect == 'mysql' else '11.4.'):
            raise AssertionError('Unexpected database version')
        applied = query(sql_path.read_text() + "\nSELECT JSON_OBJECT('sqlModeAfterApply',@@session.sql_mode);\n", timeout=60)
        (out / 'apply.stdout.txt').write_text(applied.stdout)
        (out / 'apply.stderr.txt').write_text(applied.stderr)
        if applied.returncode:
            raise RuntimeError(f'DDL apply failed: {applied.stderr}')
        report['ddlApplied'] = True
        mode_rows = json_rows(applied.stdout)
        if mode_rows != [{'sqlModeAfterApply': report['server']['sqlMode']}]:
            raise AssertionError('Generator did not restore session sql_mode')
        report['sqlModeRestored'] = True
        filt = "'" + schema + "'"
        catalog = {
            'schemas': rows(f"SELECT JSON_OBJECT('schemaName',SCHEMA_NAME,'characterSet',DEFAULT_CHARACTER_SET_NAME,'collation',DEFAULT_COLLATION_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME={filt}"),
            'tables': rows(f"SELECT JSON_OBJECT('schemaName',TABLE_SCHEMA,'tableName',TABLE_NAME,'engine',ENGINE,'collation',TABLE_COLLATION,'comment',TABLE_COMMENT,'rowFormat',ROW_FORMAT,'autoIncrement',CAST(AUTO_INCREMENT AS CHAR)) FROM information_schema.TABLES WHERE TABLE_SCHEMA={filt} ORDER BY TABLE_NAME"),
            'columns': rows(f"SELECT JSON_OBJECT('tableName',TABLE_NAME,'columnName',COLUMN_NAME,'ordinal',ORDINAL_POSITION,'dataType',DATA_TYPE,'columnType',COLUMN_TYPE,'nullable',IS_NULLABLE,'numericPrecision',NUMERIC_PRECISION,'numericScale',NUMERIC_SCALE,'characterLength',CHARACTER_MAXIMUM_LENGTH,'datetimePrecision',DATETIME_PRECISION,'defaultValue',COLUMN_DEFAULT,'comment',COLUMN_COMMENT,'collation',COLLATION_NAME,'extra',EXTRA) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA={filt} ORDER BY TABLE_NAME,ORDINAL_POSITION"),
            'indexes': rows(f"SELECT JSON_OBJECT('tableName',TABLE_NAME,'indexName',INDEX_NAME,'ordinal',SEQ_IN_INDEX,'columnName',COLUMN_NAME,'nonUnique',NON_UNIQUE,'order',COLLATION,'indexType',INDEX_TYPE,'prefixLength',SUB_PART,'comment',INDEX_COMMENT) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA={filt} ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX"),
            'constraints': rows(f"SELECT JSON_OBJECT('tableName',TABLE_NAME,'constraintName',CONSTRAINT_NAME,'type',CONSTRAINT_TYPE) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA={filt} ORDER BY TABLE_NAME,CONSTRAINT_NAME"),
            'foreignKeys': rows(f"SELECT JSON_OBJECT('tableName',TABLE_NAME,'constraintName',CONSTRAINT_NAME,'referencedTable',REFERENCED_TABLE_NAME,'updateRule',UPDATE_RULE,'deleteRule',DELETE_RULE,'matchOption',MATCH_OPTION) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA={filt} ORDER BY TABLE_NAME,CONSTRAINT_NAME"),
            'foreignKeyColumns': rows(f"SELECT JSON_OBJECT('tableName',TABLE_NAME,'constraintName',CONSTRAINT_NAME,'ordinal',ORDINAL_POSITION,'columnName',COLUMN_NAME,'referencedTable',REFERENCED_TABLE_NAME,'referencedColumn',REFERENCED_COLUMN_NAME,'positionInUnique',POSITION_IN_UNIQUE_CONSTRAINT) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA={filt} AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION"),
            'checks': rows(f"SELECT JSON_OBJECT('constraintName',CONSTRAINT_NAME,'clause',CHECK_CLAUSE) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA={filt} ORDER BY CONSTRAINT_NAME"),
        }
        (out / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
        for table in catalog['tables']:
            shown = query(f"SHOW CREATE TABLE `{schema}`.`{table['tableName'].replace('`','``')}`")
            if shown.returncode:
                raise RuntimeError(shown.stderr)
            (out / (table['tableName'] + '.show-create.sql')).write_text(shown.stdout)
        report['catalogChecks'] = {category: compare_rows(category, expected_rows, catalog[category]) for category, expected_rows in expected['catalog'].items()}
        for behavior in expected['behaviors']:
            checked = query(behavior['sql'])
            entry = {'name': behavior['name'], 'exitCode': checked.returncode, 'stdout': checked.stdout, 'stderr': checked.stderr}
            report['behaviorChecks'].append(entry)
            if 'error' in behavior:
                match = re.search(r'ERROR (\d+) \(([A-Z0-9]+)\)', checked.stderr)
                if not checked.returncode or not match:
                    raise AssertionError(f"{behavior['name']}: expected a database error")
                actual_error = {'code': int(match[1]), 'sqlState': match[2]}
                required = behavior['error']
                if any(actual_error[key] != required[key] for key in ('code', 'sqlState')) or required.get('messageContains', '') not in checked.stderr:
                    raise AssertionError(f"{behavior['name']}: unexpected error {checked.stderr}")
                entry['verifiedError'] = actual_error
            else:
                if checked.returncode:
                    raise AssertionError(f"{behavior['name']}: {checked.stderr}")
                if 'rows' in behavior:
                    compare_rows(behavior['name'], behavior['rows'], json_rows(checked.stdout))
            entry['passed'] = True
        if original_hashes != {'sql': digest(sql_path), 'expected': digest(expected_path)}:
            raise AssertionError('Input changed')
        report['passed'] = True
    except BaseException as error:
        report['error'] = str(error)
        if container_id:
            logs = command(['docker', 'logs', '--tail', '150', container_id])
            (out / 'container.log').write_text(logs.stdout + logs.stderr)
    finally:
        if container_id:
            removed = command(['docker', 'rm', '-f', '-v', container_id])
            report['cleanup'] = removed.returncode == 0
            if not report['cleanup']:
                report['cleanupError'] = removed.stderr
        (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'server': report.get('server'), 'behaviorChecks': len(report['behaviorChecks']), 'cleanup': report['cleanup'], 'output': str(out)}, ensure_ascii=False), flush=True)
    if not report['passed'] or not report['cleanup']:
        if report.get('error'):
            print(report['error'], file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
