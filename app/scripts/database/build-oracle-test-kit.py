#!/usr/bin/env python3
"""Build reviewable SQL*Plus tests from app-generated Oracle fixtures; never connects to a DB."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def literal(text):
    return "'" + text.replace("'", "''") + "'"


def block(calls):
    return """DECLARE
  PROCEDURE assert_value(label VARCHAR2, query_text VARCHAR2, expected VARCHAR2) IS
    actual VARCHAR2(4000);
  BEGIN
    EXECUTE IMMEDIATE query_text INTO actual;
    IF actual IS NULL OR actual <> expected THEN
      raise_application_error(-20001, label || ': expected=' || expected || ', actual=' || actual);
    END IF;
    dbms_output.put_line('PASS ' || label);
  END;
  PROCEDURE expect_error(label VARCHAR2, statement_text VARCHAR2, expected VARCHAR2) IS
  BEGIN
    EXECUTE IMMEDIATE statement_text;
    raise_application_error(-20002, label || ': expected error was not raised');
  EXCEPTION WHEN OTHERS THEN
    IF instr(dbms_utility.format_error_stack, expected) = 0 THEN RAISE; END IF;
    dbms_output.put_line('PASS ' || label || ' expected ' || expected);
  END;
BEGIN
""" + '\n'.join('  ' + call for call in calls) + '\nEND;\n/\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--expected-major', type=int, choices=(19, 23), default=19,
                        help='19 for company acceptance; 23 only proves harness behavior on local 26ai Free')
    args = parser.parse_args()
    source, out = args.fixtures.resolve(), args.out.resolve()
    if not source.is_relative_to(ROOT / '.analysis') or not out.is_relative_to(ROOT / '.analysis') or out == ROOT / '.analysis' or out.exists():
        parser.error('Fixtures must be below .analysis; output must be a NEW directory below .analysis')
    manifest = source / 'manifest.json'
    cases = [c for c in json.loads(manifest.read_text())['cases'] if c['dialect'] == 'oracle']
    if len(cases) != 6 or len({c['schema'] for c in cases}) != 1:
        raise ValueError('Expected six independent Oracle cases with one explicit schema')
    schema = cases[0]['schema']
    if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,29}', schema):
        raise ValueError('Schema must be a simple uppercase identifier')
    if args.expected_major == 19 and schema in ('SYS', 'SYSTEM'):
        raise ValueError('Company acceptance requires a dedicated non-administrative test schema')
    names = []
    for c in cases:
        for key in ('parent', 'child', 'constraint'):
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,29}', c[key]):
                raise ValueError('Invalid fixture identifier')
        for key in ('sql', 'model'):
            p = (source / c[key]).resolve()
            if not p.is_relative_to(source) or hashlib.sha256(p.read_bytes()).hexdigest() != c[key + 'Sha256']:
                raise ValueError('Fixture path/hash mismatch')
        if not c['complete']:
            raise ValueError('Incomplete DDL cannot be tested automatically')
        names.extend([c['parent'], c['child']])
    statements = [
        '-- Generated from independent ERD Maker models. No credentials, account changes or cleanup.',
        '-- Manifest SHA256: ' + hashlib.sha256(manifest.read_bytes()).hexdigest(),
        '-- Run once in the explicit test schema; review SQL before execution.',
        'WHENEVER OSERROR EXIT FAILURE ROLLBACK',
        'WHENEVER SQLERROR EXIT FAILURE ROLLBACK',
        'SET ECHO OFF VERIFY OFF DEFINE OFF SERVEROUTPUT ON SIZE UNLIMITED',
        'SPOOL oracle-test-result.log',
        'DECLARE n NUMBER; BEGIN',
        f"  IF sys_context('USERENV','CURRENT_SCHEMA') <> {literal(schema)} THEN raise_application_error(-20010,'Wrong test schema'); END IF;",
        *([f"  IF sys_context('USERENV','SESSION_USER') <> {literal(schema)} THEN raise_application_error(-20013,'Connect as the dedicated test user'); END IF;"] if args.expected_major == 19 else []),
        f"  IF dbms_db_version.version <> {args.expected_major} THEN raise_application_error(-20011,'Wrong Oracle major version'); END IF;",
        "  SELECT count(*) INTO n FROM all_tables WHERE owner=" + literal(schema) + ' AND table_name IN (' + ','.join(map(literal, names)) + ');',
        "  IF n <> 0 THEN raise_application_error(-20012,'Fixture tables already exist; do not overwrite'); END IF;",
        "  dbms_output.put_line('PASS preflight: schema and version, no existing fixture tables');",
        'END;\n/',
        "SELECT banner_full FROM v$version WHERE ROWNUM=1;",
    ]
    check_count = 1
    for c in cases:
        key = c['id']
        p, ch = [f'"{schema}"."{c[k]}"' for k in ('parent', 'child')]
        fk = '"' + c['constraint'] + '"'
        ddl = (source / c['sql']).read_text()
        statements.append('-- CASE ' + key + ' ' + c['kind'] + ' ' + c['action'])
        if c['kind'] == 'novalidate':
            matches = list(re.finditer(r'^ALTER TABLE .* FOREIGN KEY .*;$', ddl, re.M))
            if len(matches) != 1:
                raise ValueError('Expected one generated FK statement')
            m = matches[0]
            statements.extend([ddl[:m.start()] + ddl[m.end():], f'INSERT INTO {ch} VALUES (90,900);\nCOMMIT;', m[0]])
        else:
            statements.append(ddl)
        defer = c['kind'] == 'deferred'
        expected = '|'.join([c['action'], 'DISABLED' if c['kind'] == 'disabled' else 'ENABLED', 'NOT VALIDATED' if c['kind'] in ('disabled', 'novalidate') else 'VALIDATED', 'DEFERRABLE' if defer else 'NOT DEFERRABLE', 'DEFERRED' if defer else 'IMMEDIATE'])
        catalog = "SELECT delete_rule || '|' || status || '|' || validated || '|' || deferrable || '|' || deferred FROM all_constraints WHERE owner=" + literal(schema) + ' AND constraint_name=' + literal(c['constraint']) + " AND constraint_type='R'"
        calls = [f'assert_value({literal(key + ":catalog")},{literal(catalog)},{literal(expected)});']
        def execute(sql):
            calls.append('EXECUTE IMMEDIATE ' + literal(sql) + ';')
        def count(label, table, expected_count, where=''):
            calls.append(f'assert_value({literal(key + ":" + label)},{literal("SELECT to_char(count(*)) FROM " + table + where)},{literal(str(expected_count))});')
        def error(label, sql, code):
            calls.append(f'expect_error({literal(key + ":" + label)},{literal(sql)},{literal(code)});')
        if c['kind'] == 'disabled':
            execute(f'INSERT INTO {ch} VALUES (1,999)')
            calls.append('COMMIT;')
            count('disabled-allows-orphan', ch, 1)
            error('validate-rejects-orphan', f'ALTER TABLE {ch} ENABLE VALIDATE CONSTRAINT {fk}', 'ORA-02298')
        elif c['kind'] == 'novalidate':
            count('existing-orphan', ch, 1, ' WHERE "parent_id"=900')
            error('new-orphan', f'INSERT INTO {ch} VALUES (91,901)', 'ORA-02291')
            error('validate-existing', f'ALTER TABLE {ch} ENABLE VALIDATE CONSTRAINT {fk}', 'ORA-02298')
        elif defer:
            execute(f'INSERT INTO {ch} VALUES (1,999)')
            execute(f'INSERT INTO {p} VALUES (999)')
            calls.append('COMMIT;')
            count('deferred-repair', ch, 1)
            execute(f'INSERT INTO {ch} VALUES (2,998)')
            error('deferred-commit-rejects-orphan', 'COMMIT', 'ORA-02291')
            count('rollback', ch, 1)
        else:
            execute(f'INSERT INTO {p} VALUES (1)')
            execute(f'INSERT INTO {ch} VALUES (1,1)')
            calls.append('COMMIT;')
            error('reject-orphan', f'INSERT INTO {ch} VALUES (2,999)', 'ORA-02291')
            if c['action'] == 'NO ACTION':
                error('restrict-delete', f'DELETE FROM {p} WHERE "id"=1', 'ORA-02292')
                count('parent-unchanged', p, 1)
            else:
                execute(f'DELETE FROM {p} WHERE "id"=1')
                count('child-readback', ch, 0 if c['action'] == 'CASCADE' else 1, '' if c['action'] == 'CASCADE' else ' WHERE "parent_id" IS NULL')
        check_count += sum(call.startswith(('assert_value(', 'expect_error(')) for call in calls)
        statements.extend([block(calls), 'COMMIT;'])
    statements.extend([f'PROMPT ERD_ORACLE_TEST_PASS cases=6 assertions={check_count} expected_major={args.expected_major}', 'SPOOL OFF', 'EXIT SUCCESS'])
    out.mkdir(parents=True)
    sql_file = out / 'run.sql'
    sql_file.write_text('\n\n'.join(statements) + '\n', encoding='utf-8')
    (out / 'kit.json').write_text(json.dumps({'schema': schema, 'expectedMajor': args.expected_major, 'cases': len(cases), 'assertions': check_count, 'sourceManifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest(), 'sqlSha256': hashlib.sha256(sql_file.read_bytes()).hexdigest(), 'executedOnOracle19': False}, indent=2) + '\n')
    print(json.dumps({'out': str(out), 'cases': len(cases), 'assertions': check_count, 'connectsToDatabase': False}))


if __name__ == '__main__':
    main()
