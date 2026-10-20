/** Independent models -> saved/reopened models -> production DDL. No DB connection. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  appendNativeTable,
  createNativeDocument,
  nativeGraph,
  rebuildNativeDocument,
} from "../../src/formats/exerd/create";
import { mutateNativeDocument } from "../../src/formats/exerd/mutations";
import {
  openNativeDocument,
  saveNativeDocument,
} from "../../src/formats/exerd/native-document";
import { projectNativeDocument } from "../../src/formats/exerd/view";
import {
  generateNativeDdl,
  type NativeDialect,
} from "../../src/formats/sql/native-ddl";
import schema from "../../src/formats/exerd/schema.generated.json" with { type: "json" };
import type { BinaryRegistry } from "../../src/formats/exerd/binary";

const args = parseArgs({
  allowPositionals: true,
  options: {
    dialect: { type: "string", multiple: true },
    "oracle-schema": { type: "string", default: "SYSTEM" },
  },
});
const oracleSchema = args.values["oracle-schema"]!;
if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(oracleSchema))
  throw new Error("Oracle schema must be an uppercase simple identifier (1-30 characters)");
const selected = args.values.dialect;
if (selected?.some(d => !["oracle", "mariadb", "postgresql", "mysql"].includes(d)))
  throw new Error("Unknown dialect");
const out = resolve(args.positionals[0] || "");
if (
  args.positionals.length !== 1 ||
  !out.startsWith(resolve(".analysis") + sep) ||
  existsSync(out)
)
  throw new Error("Output must be a NEW directory below .analysis");
mkdirSync(out, { recursive: true });
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const products = {
  postgresql: "com.tomato.db.postgresql",
  oracle: "com.tomato.db.oracle_10g",
  mariadb: "com.tomato.db.mariadb",
  mysql: "com.tomato.db.mysql",
} as const;
const cases: object[] = [];
let sequence = 0;
for (const dialect of Object.keys(products) as Array<keyof typeof products>) {
  if (selected && !selected.includes(dialect)) continue;
  const actions =
    dialect === "oracle"
      ? ["NO ACTION", "CASCADE", "SET NULL"]
      : [
          "NO ACTION",
          "RESTRICT",
          "CASCADE",
          "SET NULL",
          ...(dialect === "postgresql" ? ["SET DEFAULT"] : []),
        ];
  const variants = actions.flatMap((action) =>
    (dialect === "oracle" ? ["delete"] : ["delete", "update"]).map(
      (operation) => ({ kind: "action", action, operation }),
    ),
  );
  if (dialect === "postgresql" || dialect === "oracle") {
    variants.push(
      { kind: "deferred", action: "NO ACTION", operation: "delete" },
      { kind: "novalidate", action: "NO ACTION", operation: "delete" },
    );
  }
  if (dialect === "postgresql")
    variants.push(
      { kind: "match_full", action: "NO ACTION", operation: "delete" },
      { kind: "match_simple", action: "NO ACTION", operation: "delete" },
      { kind: "deferred_restrict", action: "RESTRICT", operation: "delete" },
    );
  if (dialect === "oracle")
    variants.push({
      kind: "disabled",
      action: "NO ACTION",
      operation: "delete",
    });
  for (const variant of variants) {
    const prefix = "f" + String(++sequence).padStart(2, "0") + "_";
    const schemaName = dialect === "oracle" ? oracleSchema : "fk_verify";
    let d = appendNativeTable(
      createNativeDocument("Independent FK behavior", {
        database: { productId: products[dialect] },
      }),
      { name: "child" },
    );
    const schemaObject = d.graph.objects.find(
      (o) => o.class.name === "Schema",
    )!;
    d = mutateNativeDocument(d, {
      type: "renameSchema",
      schemaUuid: nativeGraph.uuid(schemaObject)!,
      name: schemaName,
    });
    let [parent, child] = projectNativeDocument(d).allTables;
    const composite = variant.kind.startsWith("match_");
    if (composite) {
      d = mutateNativeDocument(d, {
        type: "addColumn",
        tableUuid: parent.uuid,
        name: "part",
        dataType: parent.columns[0].type,
        nullable: false,
      });
      parent = projectNativeDocument(d).allTables[0];
      d = mutateNativeDocument(d, {
        type: "setPrimaryKey",
        tableUuid: parent.uuid,
        columnUuids: parent.columns.map((c) => c.uuid),
      });
    }
    d = mutateNativeDocument(d, {
      type: "addColumn",
      tableUuid: child.uuid,
      name: "parent_id",
      dataType: parent.columns[0].type,
      nullable: true,
      ...(variant.action === "SET DEFAULT" ? { defaultValue: "0" } : {}),
    });
    if (composite)
      d = mutateNativeDocument(d, {
        type: "addColumn",
        tableUuid: child.uuid,
        name: "parent_part",
        dataType: parent.columns[0].type,
        nullable: true,
      });
    [parent, child] = projectNativeDocument(d).allTables;
    d = mutateNativeDocument(d, {
      type: "addRelationship",
      name: "fk_parent",
      parentTableUuid: parent.uuid,
      childTableUuid: child.uuid,
      parentColumnUuids: parent.columns.map((c) => c.uuid),
      childColumnUuids: child.columns.slice(1).map((c) => c.uuid),
    });
    const relation = projectNativeDocument(d).allRelationships[0];
    const actionValue =
      dialect === "postgresql" && variant.action.startsWith("SET ")
        ? variant.action.replace(" ", "_")
        : variant.action;
    const values: Record<string, string> = {
      [dialect === "oracle"
        ? "deleteRule"
        : variant.operation === "delete"
          ? "onDeleteRule"
          : "onUpdateRule"]: actionValue,
    };
    if (variant.kind.startsWith("deferred"))
      Object.assign(values, { deferrable: "true", deferred: "true" });
    if (variant.kind === "novalidate")
      values.validated = dialect === "oracle" ? "false" : "true";
    if (variant.kind === "disabled")
      Object.assign(values, { enabled: "false", validated: "false" });
    if (composite)
      values.match = variant.kind === "match_full" ? "FULL" : "SIMPLE";
    d = mutateNativeDocument(d, {
      type: "editForeignKeyOptions",
      foreignKeyUuid: relation.uuid,
      values,
    });
    // Unique object names allow all cases in one isolated DB, including Oracle's existing SYSTEM schema.
    for (const object of d.graph.objects) {
      if (
        object.class.name === "Table" ||
        object.class.name.endsWith("ColumnGroup") ||
        object.class.name.endsWith("Constraint")
      ) {
        const name = nativeGraph.field(object, "physicalName");
        if (typeof name === "string" && name)
          nativeGraph.set(object, "physicalName", prefix + name);
      }
    }
    d = rebuildNativeDocument(d.graph, d.container);
    const bytes = saveNativeDocument(d),
      reopened = openNativeDocument(bytes, schema as BinaryRegistry);
    const ddl = generateNativeDdl(reopened, {
      dialect: dialect as NativeDialect,
    });
    if (!ddl.complete)
      throw new Error(
        JSON.stringify({
          dialect,
          variant,
          diagnostics: ddl.diagnostics,
          unsupported: ddl.unsupported,
        }),
      );
    if (generateNativeDdl(d).sql !== ddl.sql)
      throw new Error("Save/reopen changed SQL");
    const file = `${dialect}-${prefix.slice(0, -1)}`;
    writeFileSync(resolve(out, file + ".exerd"), bytes, { flag: "wx" });
    writeFileSync(resolve(out, file + ".sql"), ddl.sql, { flag: "wx" });
    cases.push({
      id: file,
      dialect,
      ...variant,
      schema: schemaName,
      parent: prefix + "new_table",
      child: prefix + "child",
      constraint: prefix + "fk_parent",
      options: values,
      sql: file + ".sql",
      model: file + ".exerd",
      sqlSha256: hash(ddl.sql),
      modelSha256: hash(bytes),
      complete: ddl.complete,
      statistics: ddl.statistics,
    });
  }
}
writeFileSync(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      format: 1,
      provenance:
        "Independent app models; production mutation, binary save/reopen and DDL APIs",
      cases,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify({ fixtures: cases.length, out }));
