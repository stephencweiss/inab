import { createRecoveryStore } from "../../src/storage/backup.js";
import { readSetup, markSetupComplete } from "../../src/storage/setup.js";
import { afterEach, expect, it } from "vitest";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { importRuns, importSources } from "../../src/storage/schema/import-sources.js";
import { accounts } from "../../src/storage/schema/accounts.js";
import { importObservations } from "../../src/storage/schema/import-observations.js";
import { importRegisterRows, importPlanRows } from "../../src/storage/schema/import-history.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function target() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  return openDatabase(f.path);
}
it("stores exact source bytes, checks source identity and preserves original evidence", async () => {
  const c = await target();
  try {
    c.db
      .insert(importRuns)
      .values({
        id: "run",
        reviewId: "review",
        reviewRevision: 1,
        completedAt: "2026-10-22",
        receiptJson: "{}",
      })
      .run();
    const source = {
      id: "source",
      importId: "run",
      role: "plan" as const,
      sha256: "a".repeat(64),
      bytes: Buffer.from("synthetic\r\n"),
      byteLength: 11,
    };
    c.db.insert(importSources).values(source).run();
    expect(c.db.select().from(importSources).get()?.bytes).toEqual(source.bytes);
    expect(() =>
      c.db
        .insert(importSources)
        .values({ ...source, id: "duplicate" })
        .run(),
    ).toThrow();
    expect(() =>
      c.db
        .insert(importSources)
        .values({ ...source, id: "bad", sha256: "b".repeat(64), byteLength: 12 })
        .run(),
    ).toThrow();
    expect(() => c.sqlite.exec("UPDATE import_sources SET bytes=X'00'")).toThrow("immutable");
    expect(() => c.sqlite.exec("DELETE FROM import_sources")).toThrow("immutable");
    const row = {
      id: "row",
      importId: "run",
      sourceId: "source",
      ordinal: 1,
      month: "2026-10",
      group: "",
      category: "",
      assignedCents: 0,
      activityCents: -50,
      availableCents: 0,
      disposition: "history-only" as const,
      originalJson: '{"blank":""}',
      normalizedJson: "{}",
    };
    c.db.insert(importPlanRows).values(row).run();
    expect(() =>
      c.db
        .insert(importPlanRows)
        .values({ ...row, id: "duplicate" })
        .run(),
    ).toThrow();
    expect(() =>
      c.db
        .insert(importPlanRows)
        .values({ ...row, id: "unrelated", sourceId: "missing" })
        .run(),
    ).toThrow();
    expect(() =>
      c.db
        .insert(importPlanRows)
        .values({ ...row, id: "fraction", ordinal: 2, assignedCents: 0.5 })
        .run(),
    ).toThrow();
    expect(() => c.sqlite.exec("UPDATE import_plan_rows SET original_json='{}'")).toThrow(
      "immutable",
    );
    c.db.transaction((tx) => markSetupComplete(tx, "ynab", "run", "2026-10-22"));
    const recovery = createRecoveryStore();
    const backup = recovery.inspect(c.sqlite.name, `${c.sqlite.name}.backup`);
    if (!backup.ok) throw new Error("backup preview");
    expect(
      (
        await recovery.copy({
          ...backup.value,
          operation: "backup",
          operationId: "backup-operation",
        })
      ).ok,
    ).toBe(true);
    const restore = recovery.inspect(backup.value.destination, `${c.sqlite.name}.restored`);
    if (!restore.ok) throw new Error("restore preview");
    expect(
      (
        await recovery.copy({
          ...restore.value,
          operation: "restore",
          operationId: "restore-operation",
        })
      ).ok,
    ).toBe(true);
    expect(readSetup(restore.value.destination)).toEqual(readSetup(c.sqlite.name));
    const restored = openDatabase(restore.value.destination);
    try {
      expect(restored.db.select().from(importSources).get()?.bytes).toEqual(source.bytes);
      expect(restored.db.select().from(importPlanRows).all()).toEqual(
        c.db.select().from(importPlanRows).all(),
      );
      expect(restored.db.select().from(importRuns).all()).toEqual(
        c.db.select().from(importRuns).all(),
      );
    } finally {
      restored.sqlite.close();
    }
  } finally {
    c.sqlite.close();
  }
});

it("rejects cross-role source rows and observations for another account", async () => {
  const c = await target();
  try {
    c.db
      .insert(importRuns)
      .values({
        id: "run",
        reviewId: "review",
        reviewRevision: 1,
        completedAt: "2026-10-22",
        receiptJson: "{}",
      })
      .run();
    c.db
      .insert(importSources)
      .values({
        id: "register",
        importId: "run",
        role: "register",
        sha256: "a".repeat(64),
        bytes: Buffer.from(""),
        byteLength: 0,
      })
      .run();
    for (const id of ["one", "two"])
      c.db
        .insert(accounts)
        .values({
          id,
          name: id,
          kind: "tracking",
          currency: "USD",
          openingCents: null,
          openingDate: null,
          revision: 1,
          createdAt: "2026-10-22",
        })
        .run();
    c.db
      .insert(importRegisterRows)
      .values({
        id: "row",
        importId: "run",
        sourceId: "register",
        ordinal: 1,
        accountId: "one",
        occurredOn: "2026-10-22",
        cents: 0,
        postedOn: "2026-10-22",
        treatment: "posted",
        role: "adjustment",
        disposition: "observation-evidence",
        originalJson: "{}",
        normalizedJson: "{}",
      })
      .run();
    const observation = {
      id: "obs",
      importId: "run",
      accountId: "two",
      sourceRowId: "row",
      effectiveDate: "2026-10-22",
      observedCents: 0,
      originalAdjustmentCents: 0,
      currentAdjustmentCents: 0,
      state: "verified" as const,
      metadataJson: "{}",
    };
    expect(() => c.db.insert(importObservations).values(observation).run()).toThrow();
    c.db
      .insert(importObservations)
      .values({ ...observation, accountId: "one" })
      .run();
    expect(() =>
      c.db
        .insert(importObservations)
        .values({ ...observation, id: "duplicate", accountId: "one", effectiveDate: "2026-10-21" })
        .run(),
    ).toThrow();
    expect(() =>
      c.db
        .insert(importPlanRows)
        .values({
          id: "wrong-role",
          importId: "run",
          sourceId: "register",
          ordinal: 1,
          month: "2026-10",
          group: "",
          category: "",
          assignedCents: 0,
          activityCents: 0,
          availableCents: 0,
          disposition: "history-only",
          originalJson: "{}",
          normalizedJson: "{}",
        })
        .run(),
    ).toThrow();
  } finally {
    c.sqlite.close();
  }
});
