-- PostgreSQL 15-17; one read-only catalog snapshot. No user-table rows or credentials.
-- Run inside a caller-owned read-only transaction when several snapshots are compared.
WITH namespaces AS (
  SELECT oid, nspname FROM pg_catalog.pg_namespace
  WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
), relations AS (
  SELECT c.* FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'f')
), table_constraints AS (
  SELECT con.* FROM pg_catalog.pg_constraint con JOIN relations r ON r.oid = con.conrelid
), table_indexes AS (
  SELECT i.*, c.relname, c.relnamespace, c.reltablespace, c.reloptions, c.relam,
         am.amname, ts.spcname AS tablespace
  FROM pg_catalog.pg_index i JOIN relations r ON r.oid = i.indrelid
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN pg_catalog.pg_am am ON am.oid = c.relam
  LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid = c.reltablespace
)
SELECT pg_catalog.jsonb_build_object(
  'format', 'erd-maker.postgresql-catalog', 'version', 1,
  'serverVersionNum', pg_catalog.current_setting('server_version_num')::integer,
  'serverVersion', pg_catalog.current_setting('server_version'),
  'database', pg_catalog.current_database(),
  'schemas', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'oid', n.oid::text, 'name', n.nspname,
    'comment', pg_catalog.obj_description(n.oid, 'pg_namespace')) ORDER BY n.nspname) FROM namespaces n), '[]'::jsonb),
  'sequences', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'oid', c.oid::text, 'schemaOid', c.relnamespace::text, 'name', c.relname,
    'dataType', pg_catalog.format_type(seq.seqtypid, NULL), 'persistence', c.relpersistence,
    'start', seq.seqstart::text, 'minValue', seq.seqmin::text, 'maxValue', seq.seqmax::text,
    'increment', seq.seqincrement::text, 'cache', seq.seqcache::text, 'cycle', seq.seqcycle,
    'comment', pg_catalog.obj_description(c.oid, 'pg_class'),
    'ownedBy', (SELECT pg_catalog.jsonb_build_object('tableOid', d.refobjid::text,
      'columnNumber', d.refobjsubid, 'dependencyType', d.deptype)
      FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND d.objid = c.oid AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
      AND d.refobjsubid > 0 AND d.deptype IN ('a', 'i') LIMIT 1)) ORDER BY c.relnamespace, c.relname)
    FROM pg_catalog.pg_sequence seq JOIN pg_catalog.pg_class c ON c.oid = seq.seqrelid
    JOIN namespaces n ON n.oid = c.relnamespace), '[]'::jsonb),
  'tables', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'oid', r.oid::text, 'schemaOid', r.relnamespace::text, 'name', r.relname,
    'kind', r.relkind, 'persistence', r.relpersistence,
    'comment', pg_catalog.obj_description(r.oid, 'pg_class'),
    'partition', r.relispartition, 'partitionKey', pg_catalog.pg_get_partkeydef(r.oid),
    'parents', COALESCE((SELECT pg_catalog.jsonb_agg(i.inhparent::text ORDER BY i.inhseqno) FROM pg_catalog.pg_inherits i WHERE i.inhrelid = r.oid), '[]'::jsonb),
    'rowSecurity', r.relrowsecurity, 'forceRowSecurity', r.relforcerowsecurity,
    'replicaIdentity', r.relreplident, 'options', r.reloptions,
    'tablespace', (SELECT t.spcname FROM pg_catalog.pg_tablespace t WHERE t.oid = r.reltablespace))
    ORDER BY r.relnamespace, r.relname) FROM relations r), '[]'::jsonb),
  'columns', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'tableOid', a.attrelid::text, 'number', a.attnum, 'name', a.attname,
    'dataType', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'typeOid', a.atttypid::text, 'typeSchema', tn.nspname, 'typeName', typ.typname, 'typeKind', typ.typtype,
    'notNull', a.attnotnull, 'defaultExpression', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false),
    'comment', pg_catalog.col_description(a.attrelid, a.attnum),
    'identity', a.attidentity, 'generated', a.attgenerated,
    'collation', CASE WHEN a.attcollation <> typ.typcollation THEN pg_catalog.format('%I.%I', cn.nspname, col.collname) ELSE NULL END,
    'inherited', a.attinhcount, 'local', a.attislocal,
    'storage', a.attstorage, 'typeStorage', typ.typstorage,
    'compression', a.attcompression, 'options', a.attoptions, 'fdwOptions', a.attfdwoptions,
    'statisticsTarget', a.attstattarget)
    ORDER BY a.attrelid, a.attnum)
    FROM pg_catalog.pg_attribute a JOIN relations r ON r.oid = a.attrelid
    JOIN pg_catalog.pg_type typ ON typ.oid = a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid = typ.typnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation col ON col.oid = a.attcollation LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid = col.collnamespace
    WHERE a.attnum > 0 AND NOT a.attisdropped), '[]'::jsonb),
  'constraints', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'oid', con.oid::text, 'tableOid', con.conrelid::text, 'name', con.conname, 'type', con.contype,
    'columns', COALESCE(pg_catalog.to_jsonb(con.conkey), '[]'::jsonb),
    'referencedTableOid', NULLIF(con.confrelid, 0)::text,
    'referencedColumns', COALESCE(pg_catalog.to_jsonb(con.confkey), '[]'::jsonb),
    'indexOid', NULLIF(con.conindid, 0)::text,
    'deferrable', con.condeferrable, 'deferred', con.condeferred, 'validated', con.convalidated,
    'deleteAction', con.confdeltype, 'updateAction', con.confupdtype, 'match', con.confmatchtype,
    'deleteSetColumns', pg_catalog.to_jsonb(con.confdelsetcols),
    'noInherit', con.connoinherit, 'inherited', con.coninhcount, 'local', con.conislocal,
    'parentOid', NULLIF(con.conparentid, 0)::text,
    'expression', CASE WHEN con.contype = 'c' THEN pg_catalog.pg_get_expr(con.conbin, con.conrelid, false) ELSE NULL END,
    'definition', pg_catalog.pg_get_constraintdef(con.oid, false),
    'comment', pg_catalog.obj_description(con.oid, 'pg_constraint')) ORDER BY con.conrelid, con.oid)
    FROM table_constraints con), '[]'::jsonb),
  'indexes', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'oid', i.indexrelid::text, 'tableOid', i.indrelid::text, 'name', i.relname, 'method', i.amname,
    'unique', i.indisunique, 'primary', i.indisprimary, 'exclusion', i.indisexclusion,
    'constraintOid', (SELECT con.oid::text FROM table_constraints con WHERE con.conindid = i.indexrelid AND con.conrelid = i.indrelid AND con.contype IN ('p', 'u', 'x') LIMIT 1),
    'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive,
    'clustered', i.indisclustered, 'replicaIdentity', i.indisreplident, 'nullsNotDistinct', i.indnullsnotdistinct,
    'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid, false), 'options', i.reloptions,
    'tablespace', i.tablespace, 'comment', pg_catalog.obj_description(i.indexrelid, 'pg_class'),
    'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, false),
    'keys', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'number', k.position, 'attributeNumber', k.attnum,
      'definition', pg_catalog.pg_get_indexdef(i.indexrelid, k.position::integer, false),
      'descending', COALESCE(pg_catalog.pg_index_column_has_property(i.indexrelid, k.position::integer, 'desc'), false),
      'nullsFirst', COALESCE(pg_catalog.pg_index_column_has_property(i.indexrelid, k.position::integer, 'nulls_first'), false),
      'opclass', CASE WHEN opc.opcdefault THEN NULL ELSE pg_catalog.format('%I.%I', opn.nspname, opc.opcname) END,
      'collation', CASE WHEN coll.oid IS NOT NULL AND coll.oid <> COALESCE(att.attcollation, 0) THEN pg_catalog.format('%I.%I', colln.nspname, coll.collname) ELSE NULL END)
      ORDER BY k.position)
      FROM pg_catalog.unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, position)
      LEFT JOIN pg_catalog.pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k.attnum
      LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[(k.position - 1)::integer]
      LEFT JOIN pg_catalog.pg_namespace opn ON opn.oid = opc.opcnamespace
      LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = i.indcollation[(k.position - 1)::integer]
      LEFT JOIN pg_catalog.pg_namespace colln ON colln.oid = coll.collnamespace
      WHERE k.position <= i.indnkeyatts), '[]'::jsonb),
    'includedColumns', COALESCE((SELECT pg_catalog.jsonb_agg(k.attnum ORDER BY k.position)
      FROM pg_catalog.unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, position)
      WHERE k.position > i.indnkeyatts), '[]'::jsonb)) ORDER BY i.indrelid, i.indexrelid)
    FROM table_indexes i), '[]'::jsonb),
  'unsupportedObjects', COALESCE((SELECT pg_catalog.jsonb_agg(item) FROM (
    SELECT pg_catalog.jsonb_build_object('kind', c.relkind::text, 'schema', n.nspname, 'name', c.relname,
      'definition', CASE WHEN c.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(c.oid, false) ELSE NULL END) AS item
      FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid = c.relnamespace WHERE c.relkind IN ('v', 'm')
    UNION ALL SELECT pg_catalog.jsonb_build_object('kind', 'type:' || t.typtype::text, 'schema', n.nspname, 'name', t.typname)
      FROM pg_catalog.pg_type t JOIN namespaces n ON n.oid = t.typnamespace WHERE t.typtype IN ('d', 'e', 'r', 'm')
    UNION ALL SELECT pg_catalog.jsonb_build_object('kind', 'trigger', 'schema', n.nspname, 'name', tr.tgname,
      'table', c.relname, 'definition', pg_catalog.pg_get_triggerdef(tr.oid, false))
      FROM pg_catalog.pg_trigger tr JOIN relations c ON c.oid = tr.tgrelid JOIN namespaces n ON n.oid = c.relnamespace WHERE NOT tr.tgisinternal
    UNION ALL SELECT pg_catalog.jsonb_build_object('kind', 'rule', 'schema', n.nspname, 'name', rw.rulename,
      'table', c.relname, 'definition', pg_catalog.pg_get_ruledef(rw.oid, false))
      FROM pg_catalog.pg_rewrite rw JOIN relations c ON c.oid = rw.ev_class JOIN namespaces n ON n.oid = c.relnamespace
  ) omitted), '[]'::jsonb)
);
