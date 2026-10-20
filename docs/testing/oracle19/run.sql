-- Generated from independent ERD Maker models. No credentials, account changes or cleanup.

-- Manifest SHA256: 143eec39c9749371518c1c6885444996cd37839bdddd186f9a1ba9d661b31eab

-- Run once in the explicit test schema; review SQL before execution.

WHENEVER OSERROR EXIT FAILURE ROLLBACK

WHENEVER SQLERROR EXIT FAILURE ROLLBACK

SET ECHO OFF VERIFY OFF DEFINE OFF SERVEROUTPUT ON SIZE UNLIMITED

SPOOL oracle-test-result.log

DECLARE n NUMBER; BEGIN

  IF sys_context('USERENV','CURRENT_SCHEMA') <> 'ERD_TEST' THEN raise_application_error(-20010,'Wrong test schema'); END IF;

  IF sys_context('USERENV','SESSION_USER') <> 'ERD_TEST' THEN raise_application_error(-20013,'Connect as the dedicated test user'); END IF;

  IF dbms_db_version.version <> 19 THEN raise_application_error(-20011,'Wrong Oracle major version'); END IF;

  SELECT count(*) INTO n FROM all_tables WHERE owner='ERD_TEST' AND table_name IN ('f01_new_table','f01_child','f02_new_table','f02_child','f03_new_table','f03_child','f04_new_table','f04_child','f05_new_table','f05_child','f06_new_table','f06_child');

  IF n <> 0 THEN raise_application_error(-20012,'Fixture tables already exist; do not overwrite'); END IF;

  dbms_output.put_line('PASS preflight: schema and version, no existing fixture tables');

END;
/

SELECT banner_full FROM v$version WHERE ROWNUM=1;

-- CASE oracle-f01 action NO ACTION

CREATE TABLE "ERD_TEST"."f01_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f01_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f01_pk_new_table" ON "ERD_TEST"."f01_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f01_pk_child" ON "ERD_TEST"."f01_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f01_new_table" ADD CONSTRAINT "f01_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f01_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f01_child" ADD CONSTRAINT "f01_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f01_pk_child" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f01_child" ADD CONSTRAINT "f01_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f01_new_table" ("id") NOT DEFERRABLE ENABLE VALIDATE;


DECLARE
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
  assert_value('oracle-f01:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f01_fk_parent'' AND constraint_type=''R''','NO ACTION|ENABLED|VALIDATED|NOT DEFERRABLE|IMMEDIATE');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f01_new_table" VALUES (1)';
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f01_child" VALUES (1,1)';
  COMMIT;
  expect_error('oracle-f01:reject-orphan','INSERT INTO "ERD_TEST"."f01_child" VALUES (2,999)','ORA-02291');
  expect_error('oracle-f01:restrict-delete','DELETE FROM "ERD_TEST"."f01_new_table" WHERE "id"=1','ORA-02292');
  assert_value('oracle-f01:parent-unchanged','SELECT to_char(count(*)) FROM "ERD_TEST"."f01_new_table"','1');
END;
/


COMMIT;

-- CASE oracle-f02 action CASCADE

CREATE TABLE "ERD_TEST"."f02_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f02_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f02_pk_new_table" ON "ERD_TEST"."f02_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f02_pk_child" ON "ERD_TEST"."f02_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f02_new_table" ADD CONSTRAINT "f02_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f02_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f02_child" ADD CONSTRAINT "f02_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f02_pk_child" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f02_child" ADD CONSTRAINT "f02_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f02_new_table" ("id") ON DELETE CASCADE NOT DEFERRABLE ENABLE VALIDATE;


DECLARE
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
  assert_value('oracle-f02:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f02_fk_parent'' AND constraint_type=''R''','CASCADE|ENABLED|VALIDATED|NOT DEFERRABLE|IMMEDIATE');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f02_new_table" VALUES (1)';
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f02_child" VALUES (1,1)';
  COMMIT;
  expect_error('oracle-f02:reject-orphan','INSERT INTO "ERD_TEST"."f02_child" VALUES (2,999)','ORA-02291');
  EXECUTE IMMEDIATE 'DELETE FROM "ERD_TEST"."f02_new_table" WHERE "id"=1';
  assert_value('oracle-f02:child-readback','SELECT to_char(count(*)) FROM "ERD_TEST"."f02_child"','0');
END;
/


COMMIT;

-- CASE oracle-f03 action SET NULL

CREATE TABLE "ERD_TEST"."f03_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f03_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f03_pk_new_table" ON "ERD_TEST"."f03_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f03_pk_child" ON "ERD_TEST"."f03_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f03_new_table" ADD CONSTRAINT "f03_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f03_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f03_child" ADD CONSTRAINT "f03_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f03_pk_child" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f03_child" ADD CONSTRAINT "f03_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f03_new_table" ("id") ON DELETE SET NULL NOT DEFERRABLE ENABLE VALIDATE;


DECLARE
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
  assert_value('oracle-f03:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f03_fk_parent'' AND constraint_type=''R''','SET NULL|ENABLED|VALIDATED|NOT DEFERRABLE|IMMEDIATE');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f03_new_table" VALUES (1)';
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f03_child" VALUES (1,1)';
  COMMIT;
  expect_error('oracle-f03:reject-orphan','INSERT INTO "ERD_TEST"."f03_child" VALUES (2,999)','ORA-02291');
  EXECUTE IMMEDIATE 'DELETE FROM "ERD_TEST"."f03_new_table" WHERE "id"=1';
  assert_value('oracle-f03:child-readback','SELECT to_char(count(*)) FROM "ERD_TEST"."f03_child" WHERE "parent_id" IS NULL','1');
END;
/


COMMIT;

-- CASE oracle-f04 deferred NO ACTION

CREATE TABLE "ERD_TEST"."f04_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f04_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f04_pk_new_table" ON "ERD_TEST"."f04_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f04_pk_child" ON "ERD_TEST"."f04_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f04_new_table" ADD CONSTRAINT "f04_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f04_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f04_child" ADD CONSTRAINT "f04_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f04_pk_child" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f04_child" ADD CONSTRAINT "f04_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f04_new_table" ("id") DEFERRABLE INITIALLY DEFERRED ENABLE VALIDATE;


DECLARE
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
  assert_value('oracle-f04:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f04_fk_parent'' AND constraint_type=''R''','NO ACTION|ENABLED|VALIDATED|DEFERRABLE|DEFERRED');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f04_child" VALUES (1,999)';
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f04_new_table" VALUES (999)';
  COMMIT;
  assert_value('oracle-f04:deferred-repair','SELECT to_char(count(*)) FROM "ERD_TEST"."f04_child"','1');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f04_child" VALUES (2,998)';
  expect_error('oracle-f04:deferred-commit-rejects-orphan','COMMIT','ORA-02291');
  assert_value('oracle-f04:rollback','SELECT to_char(count(*)) FROM "ERD_TEST"."f04_child"','1');
END;
/


COMMIT;

-- CASE oracle-f05 novalidate NO ACTION

CREATE TABLE "ERD_TEST"."f05_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f05_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f05_pk_new_table" ON "ERD_TEST"."f05_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f05_pk_child" ON "ERD_TEST"."f05_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f05_new_table" ADD CONSTRAINT "f05_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f05_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f05_child" ADD CONSTRAINT "f05_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f05_pk_child" ENABLE VALIDATE;




INSERT INTO "ERD_TEST"."f05_child" VALUES (90,900);
COMMIT;

ALTER TABLE "ERD_TEST"."f05_child" ADD CONSTRAINT "f05_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f05_new_table" ("id") NOT DEFERRABLE ENABLE NOVALIDATE;

DECLARE
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
  assert_value('oracle-f05:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f05_fk_parent'' AND constraint_type=''R''','NO ACTION|ENABLED|NOT VALIDATED|NOT DEFERRABLE|IMMEDIATE');
  assert_value('oracle-f05:existing-orphan','SELECT to_char(count(*)) FROM "ERD_TEST"."f05_child" WHERE "parent_id"=900','1');
  expect_error('oracle-f05:new-orphan','INSERT INTO "ERD_TEST"."f05_child" VALUES (91,901)','ORA-02291');
  expect_error('oracle-f05:validate-existing','ALTER TABLE "ERD_TEST"."f05_child" ENABLE VALIDATE CONSTRAINT "f05_fk_parent"','ORA-02298');
END;
/


COMMIT;

-- CASE oracle-f06 disabled NO ACTION

CREATE TABLE "ERD_TEST"."f06_new_table" (
  "id" INTEGER NOT NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE TABLE "ERD_TEST"."f06_child" (
  "id" INTEGER NOT NULL,
  "parent_id" INTEGER NULL
) LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT;

CREATE UNIQUE INDEX "ERD_TEST"."f06_pk_new_table" ON "ERD_TEST"."f06_new_table" ("id" ASC) NOLOGGING;

CREATE UNIQUE INDEX "ERD_TEST"."f06_pk_child" ON "ERD_TEST"."f06_child" ("id" ASC) NOLOGGING;

ALTER TABLE "ERD_TEST"."f06_new_table" ADD CONSTRAINT "f06_pk_new_table" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f06_pk_new_table" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f06_child" ADD CONSTRAINT "f06_pk_child" PRIMARY KEY ("id") NOT DEFERRABLE USING INDEX "ERD_TEST"."f06_pk_child" ENABLE VALIDATE;

ALTER TABLE "ERD_TEST"."f06_child" ADD CONSTRAINT "f06_fk_parent" FOREIGN KEY ("parent_id") REFERENCES "ERD_TEST"."f06_new_table" ("id") NOT DEFERRABLE DISABLE NOVALIDATE;


DECLARE
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
  assert_value('oracle-f06:catalog','SELECT delete_rule || ''|'' || status || ''|'' || validated || ''|'' || deferrable || ''|'' || deferred FROM all_constraints WHERE owner=''ERD_TEST'' AND constraint_name=''f06_fk_parent'' AND constraint_type=''R''','NO ACTION|DISABLED|NOT VALIDATED|NOT DEFERRABLE|IMMEDIATE');
  EXECUTE IMMEDIATE 'INSERT INTO "ERD_TEST"."f06_child" VALUES (1,999)';
  COMMIT;
  assert_value('oracle-f06:disabled-allows-orphan','SELECT to_char(count(*)) FROM "ERD_TEST"."f06_child"','1');
  expect_error('oracle-f06:validate-rejects-orphan','ALTER TABLE "ERD_TEST"."f06_child" ENABLE VALIDATE CONSTRAINT "f06_fk_parent"','ORA-02298');
END;
/


COMMIT;

PROMPT ERD_ORACLE_TEST_PASS cases=6 assertions=22 expected_major=19

SPOOL OFF

EXIT SUCCESS
