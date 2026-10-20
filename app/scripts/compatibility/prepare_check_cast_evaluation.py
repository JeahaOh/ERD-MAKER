#!/usr/bin/env python3
"""Prepare SELECT-only evaluation for the observed varchar ARRAY cast rewrite.

Does not execute SQL or claim general expression equivalence. Only exact,
single-column literal enum checks with this known cast distribution are accepted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
LITERAL = re.compile(r"'(?:''|[^'])*'::character varying")
ARRAY = re.compile(r"\(ARRAY\[((?:'(?:''|[^'])*'::character varying)(?:, '(?:''|[^'])*'::character varying)*)\]\)::text\[\]")

def sql_string(value):
    return 'NULL' if value is None else "'" + value.replace("'", "''") + "'"

def sql_identifier(value):
    return '"' + value.replace('"', '""') + '"'

def identities(catalog):
    schemas = {row['oid']: row['name'] for row in catalog['schemas']}
    tables = {row['oid']: (schemas[row['schemaOid']], row['name']) for row in catalog['tables']}
    return {tables[row['tableOid']] + (row['name'],): row for row in catalog['constraints'] if row['type'] == 'c'}

def prepare(before, after, output):
    left, right = json.loads(before.read_text()), json.loads(after.read_text())
    checks_before, checks_after = identities(left), identities(right)
    if checks_before.keys() != checks_after.keys():
        raise ValueError('CHECK identities differ; evaluation cannot hide added/removed checks')
    columns = {(row['tableOid'], row['number']): row for row in left['columns']}
    selects, plans = [], []
    for identity, row in checks_before.items():
        other = checks_after[identity]
        if row['expression'] == other['expression']:
            continue
        expression = row['expression']
        match = ARRAY.search(expression)
        if not match or len(row['columns']) != 1:
            raise ValueError('Difference outside the supported single-column literal ARRAY cast shape')
        column = columns[(row['tableOid'], row['columns'][0])]
        if not re.fullmatch(r'character varying\([1-9]\d*\)', column['dataType']):
            raise ValueError('Only the observed bounded varchar columns are supported')
        literals = LITERAL.findall(match.group(1))
        if ', '.join(literals) != match.group(1):
            raise ValueError('Unrecognized array literal syntax')
        quoted_column = sql_identifier(column['name'])
        expected = f'(({quoted_column})::text = ANY ((ARRAY[{match.group(1)}])::text[]))'
        transformed = expected.replace(match.group(0), 'ARRAY[' + ', '.join('(' + item + ')::text' for item in literals) + ']')
        if expression != expected or other['expression'] != transformed:
            raise ValueError('Difference is not exactly the documented ARRAY element cast distribution')
        decoded = [literal[: -len('::character varying')][1:-1].replace("''", "'") for literal in literals]
        candidates = [None, '', '__ERD_INVALID__', ' ', '\t', '\n', 'Y', 'N', 'y', 'n', '0', '1', "O'Reilly", '한글']
        for literal in decoded:
            candidates += [literal, literal.lower(), literal.upper(), ' ' + literal, literal + ' ', literal + '_invalid']
        candidates = list(dict.fromkeys(candidates))
        values = ',\n'.join(f'({number}, {sql_string(value)}::{column["dataType"]})' for number, value in enumerate(candidates))
        # Evaluate both original expressions against the same typed candidate row.
        # SQL NULL differences use IS DISTINCT FROM, never equality alone.
        selects.append(f'SELECT {sql_string(json.dumps(identity, ensure_ascii=False))} AS check_id, v.sample_no,\n ({expression}) AS before_value,\n ({other["expression"]}) AS after_value\n FROM (VALUES\n{values}\n) AS v(sample_no, {quoted_column})')
        plans.append({'identity': identity, 'dataType': column['dataType'], 'candidateCount': len(candidates), 'allEnumLiteralsIncluded': True})
    sql = ('-- Read-only VALUES/SELECT evaluation. No user tables, DDL, or data changes.\nWITH evaluated AS (\n' + '\nUNION ALL\n'.join(selects) + "\n)\nSELECT jsonb_build_object(\n 'checks', count(DISTINCT check_id), 'evaluations', count(*),\n 'mismatches', count(*) FILTER (WHERE before_value IS DISTINCT FROM after_value),\n 'checksWithTrue', count(DISTINCT check_id) FILTER (WHERE before_value IS TRUE),\n 'checksWithFalse', count(DISTINCT check_id) FILTER (WHERE before_value IS FALSE),\n 'checksWithNull', count(DISTINCT check_id) FILTER (WHERE before_value IS NULL),\n 'trueResults', count(*) FILTER (WHERE before_value IS TRUE),\n 'falseResults', count(*) FILTER (WHERE before_value IS FALSE),\n 'nullResults', count(*) FILTER (WHERE before_value IS NULL),\n 'details', COALESCE(jsonb_agg(jsonb_build_object('check',check_id,'sample',sample_no,'before',before_value,'after',after_value)) FILTER (WHERE before_value IS DISTINCT FROM after_value), '[]'::jsonb)\n) FROM evaluated;\n")
    if not selects:
        raise ValueError('No supported changed CHECK expressions to evaluate')
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.analysis') or output.exists():
        raise ValueError('Output must be a new directory below project .analysis')
    output.mkdir(parents=True)
    (output / 'evaluate.sql').write_text(sql)
    report = {'before': str(before), 'after': str(after), 'sourceSha256': hashlib.sha256(before.read_bytes()).hexdigest(), 'targetSha256': hashlib.sha256(after.read_bytes()).hexdigest(), 'sqlSha256': hashlib.sha256(sql.encode()).hexdigest(), 'checks': len(plans), 'evaluations': sum(p['candidateCount'] for p in plans), 'plans': plans, 'officialRule': 'https://www.postgresql.org/docs/17/sql-expressions.html#SQL-SYNTAX-ARRAY-CONSTRUCTORS', 'limitation': 'Restricted cast shape plus finite typed samples; no general SQL logical-equivalence proof and no arbitrary input evaluation.'}
    (output / 'plan.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': report['checks'], 'evaluations': report['evaluations'], 'sql': str(output / 'evaluate.sql')}, ensure_ascii=False))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.before.resolve(), args.after.resolve(), args.output)
