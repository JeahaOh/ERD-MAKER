import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createNativeDocument,
  appendNativeTable,
} from "../../src/formats/exerd/create";
import { mutateNativeDocument } from "../../src/formats/exerd/mutations";
import {
  openNativeDocument,
  saveNativeDocument,
} from "../../src/formats/exerd/native-document";
import { projectNativeDocument } from "../../src/formats/exerd/view";
import { generateNativeDdl } from "../../src/formats/sql/native-ddl";
import schema from "../../src/formats/exerd/schema.generated.json" with { type: "json" };
import type { BinaryRegistry } from "../../src/formats/exerd/binary";

for (const database of [
  {
    name: "Oracle",
    productId: "com.tomato.db.oracle_10g",
    actionField: "deleteRule",
  },
  {
    name: "MariaDB",
    productId: "com.tomato.db.mariadb",
    actionField: "onDeleteRule",
  },
  {
    name: "MySQL",
    productId: "com.tomato.db.mysql",
    actionField: "onDeleteRule",
  },
] as const) {
  test(`${database.name} FK options use their own metadata and survive browser save/undo`, async ({
    page,
  }) => {
    let document = appendNativeTable(
      createNativeDocument(`${database.name} FK`, {
        database: { productId: database.productId },
      }),
      { name: "child", x: 650, y: 100 },
    );
    let [parent, child] = projectNativeDocument(document).allTables;
    document = mutateNativeDocument(document, {
      type: "addColumn",
      tableUuid: child.uuid,
      name: "parent_id",
      dataType: parent.columns[0].type,
      nullable: true,
    });
    [parent, child] = projectNativeDocument(document).allTables;
    document = mutateNativeDocument(document, {
      type: "addRelationship",
      name: "fk_options",
      parentTableUuid: parent.uuid,
      childTableUuid: child.uuid,
      parentColumnUuids: [parent.columns[0].uuid],
      childColumnUuids: [child.columns[1].uuid],
    });
    const before = projectNativeDocument(document).allRelationships[0];
    await page.goto("/");
    await page
      .getByLabel("eXERD 모델 파일", { exact: true })
      .setInputFiles({
        name: `${database.name}.exerd`,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(saveNativeDocument(document)),
      });
    await page
      .getByRole("button", { name: "전체 화면에 맞추기", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "관계 fk_options · default_schema.child",
        exact: true,
      })
      .click();
    const deletion = page.getByLabel("FK 삭제 동작", { exact: true });
    await expect(
      deletion.locator("option", { hasText: "SET DEFAULT" }),
    ).toHaveCount(0);
    await deletion.selectOption("SET NULL");
    if (database.name === "Oracle") {
      await expect(
        page.getByLabel("FK 갱신 동작", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByLabel("FK 지연 가능", { exact: true })
        .selectOption("true");
      await page
        .getByLabel("FK 처음부터 지연", { exact: true })
        .selectOption("true");
      await page
        .getByLabel("FK 검증 상태", { exact: true })
        .selectOption("false");
    } else {
      await expect(
        page.getByLabel("FK 지연 가능", { exact: true }),
      ).toHaveCount(0);
      await page
        .getByLabel("FK 갱신 동작", { exact: true })
        .selectOption("CASCADE");
    }
    await page
      .getByRole("button", { name: "FK 옵션 적용", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "FK 옵션 적용", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(deletion).toHaveValue("__UNSET__");
    await page.getByRole("button", { name: "다시 실행", exact: true }).click();
    await expect(deletion).toHaveValue("SET NULL");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "파일 저장", exact: true }).click();
    const downloaded = await pending;
    const saved = openNativeDocument(
      readFileSync((await downloaded.path())!),
      schema as BinaryRegistry,
    );
    const after = projectNativeDocument(saved).allRelationships[0];
    expect(after).toMatchObject({
      uuid: before.uuid,
      constraintUuid: before.constraintUuid,
      parentKeyUuid: before.parentKeyUuid,
      parentColumnUuids: before.parentColumnUuids,
      childColumnUuids: before.childColumnUuids,
      identifying: before.identifying,
      parentCardinality: before.parentCardinality,
      childCardinality: before.childCardinality,
    });
    expect(
      after.options.find((option) => option.name === database.actionField)
        ?.value,
    ).toBe("SET NULL");
    expect(projectNativeDocument(saved).allTables).toEqual(
      projectNativeDocument(document).allTables,
    );
    const ddl = generateNativeDdl(saved);
    expect(ddl.complete).toBe(true);
    expect(ddl.dialect).toBe(database.name.toLowerCase());
    expect(ddl.sql).toContain(
      database.name === "Oracle"
        ? "ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED ENABLE NOVALIDATE"
        : "ON DELETE SET NULL ON UPDATE CASCADE",
    );
  });
}
