import { createReconciliations } from "../../src/application/reconcile.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createAccounts, parseNewAccount } from "../../src/application/accounts.js";
import { accounts } from "../../src/storage/schema/accounts.js";
import { changes } from "../../src/storage/schema/changes.js";
import { temporaryDatabase } from "../helpers/database.js";

const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
async function setup() {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  let sequence = 0;
  const app = createAccounts(createAccountStore(fixture.path), {
    id: () => `synthetic-${++sequence}`,
    now: () => "2026-10-17T12:00:00.000Z",
    today: () => "2026-10-17",
  });
  return { ...fixture, app };
}
const cash = {
  name: "Synthetic",
  kind: "cash",
  currency: "USD",
  openingCents: 12345,
  openingDate: "2026-10-16",
} as const;
it("creates separate permanent IDs for duplicate names and persists complete values", async () => {
  const { app, path } = await setup();
  const first = app.previewAdd(cash);
  const second = app.previewAdd(cash);
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) throw new Error("Expected preview");
  expect(app.commit(first.value)).toMatchObject({
    ok: true,
    value: { operationId: first.value.operationId, account: { revision: 1 } },
  });
  expect(app.commit(second.value).ok).toBe(true);
  const restarted = createAccounts(createAccountStore(path), {
    id: () => "unused",
    now: () => "2026-10-17T12:00:00.000Z",
    today: () => "2026-10-17",
  });
  expect(restarted.list()).toHaveLength(2);
  expect(first.value.after.id).not.toBe(second.value.after.id);
  expect(restarted.show(first.value.after.id)).toMatchObject({
    ok: true,
    value: { name: "Synthetic", revision: 1, openingCents: 12345 },
  });
  expect(restarted.show("Synthetic")).toEqual({ ok: false, reason: "account-unavailable" });
});
it("validates account names, USD, opening pairs, dates, and safe amounts", async () => {
  const { app } = await setup();
  for (const input of [
    { ...cash, name: " " },
    { ...cash, currency: "EUR" },
    { ...cash, kind: "other" },
    { ...cash, openingDate: "2026-02-30" },
    { ...cash, openingCents: Number.MAX_SAFE_INTEGER + 1 },
    { ...cash, kind: "tracking" },
    { ...cash, openingDate: null },
  ])
    expect(parseNewAccount(input).ok).toBe(false);
  for (const kind of ["cash", "credit"] as const) {
    const preview = app.previewAdd({ ...cash, kind, openingCents: -12345 });
    expect(preview.ok).toBe(true);
  }
  const tracking = app.previewAdd({
    name: "Synthetic tracking",
    kind: "tracking",
    currency: "USD",
    openingDate: null,
    openingCents: null,
  });
  expect(tracking.ok).toBe(true);
  if (!tracking.ok) throw new Error("Expected tracking");
  expect(app.commit(tracking.value)).toMatchObject({
    ok: true,
    value: { account: { openingDate: null, openingCents: null } },
  });
});
it("previews old/new values and rejects stale writes inside the transaction", async () => {
  const { app } = await setup();
  const added = app.previewAdd(cash);
  if (!added.ok) throw new Error("Expected preview");
  app.commit(added.value);
  const id = added.value.after.id;
  const preview = app.previewRename(id, 1, "Renamed");
  const stale = app.previewOpening(id, 1, -2345, "2026-10-15");
  expect(preview).toMatchObject({
    ok: true,
    value: { before: { name: "Synthetic", revision: 1 }, after: { name: "Renamed", revision: 2 } },
  });
  if (!preview.ok || !stale.ok) throw new Error("Expected edit previews");
  expect(app.commit(preview.value).ok).toBe(true);
  expect(app.commit(stale.value)).toEqual({ ok: false, reason: "stale-version" });
  expect(app.show(id)).toMatchObject({ ok: true, value: { id, name: "Renamed", revision: 2 } });
  const correction = app.previewOpening(id, 2, -2345, "2026-10-15");
  if (!correction.ok) throw new Error("Expected opening preview");
  expect(app.commit(correction.value).ok).toBe(true);
  expect(app.show(id)).toMatchObject({
    ok: true,
    value: { openingCents: -2345, openingDate: "2026-10-15", revision: 3 },
  });
});
it("rejects opening corrections across posted entries and rechecks after preview", async () => {
  const { app, path } = await setup();
  const added = app.previewAdd(cash);
  if (!added.ok) throw new Error("Expected preview");
  app.commit(added.value);
  const id = added.value.after.id;
  const preview = app.previewOpening(id, 1, 100, "2026-10-17");
  if (!preview.ok) throw new Error("Expected preview");
  const connection = openDatabase(path);
  try {
    connection.sqlite
      .prepare("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "posted",
        id,
        "2026-10-17",
        "2026-10-17",
        -100,
        "Synthetic",
        "",
        1,
        "2026-10-17T12:00:00.000Z",
        "2026-10-17T12:00:00.000Z",
      );
  } finally {
    connection.sqlite.close();
  }
  expect(app.commit(preview.value)).toEqual({ ok: false, reason: "posting-in-opening-period" });
  expect(app.previewOpening(id, 1, 100, "2026-10-17")).toEqual({
    ok: false,
    reason: "posting-in-opening-period",
  });
});
it("rolls account creation, rename, and opening correction back when history fails", async () => {
  const { app, path } = await setup();
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    const added = app.previewAdd(cash);
    if (!added.ok) throw new Error("Expected preview");
    expect(() => app.commit(added.value)).toThrow("synthetic failure");
    expect(app.list()).toEqual([]);
    connection.sqlite.exec("DROP TRIGGER fail_history");
    expect(app.commit(added.value).ok).toBe(true);
    const id = added.value.after.id;
    for (const preview of [
      app.previewRename(id, 1, "Changed"),
      app.previewOpening(id, 1, 10, "2026-10-15"),
    ]) {
      if (!preview.ok) throw new Error("Expected preview");
      connection.sqlite.exec(
        "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
      );
      expect(() => app.commit(preview.value)).toThrow("synthetic failure");
      expect(connection.db.select().from(accounts).where(eq(accounts.id, id)).get()).toMatchObject({
        name: "Synthetic",
        revision: 1,
        openingCents: 12345,
      });
      expect(connection.db.select().from(changes).all()).toHaveLength(1);
      connection.sqlite.exec("DROP TRIGGER fail_history");
    }
    const audit = connection.db.select().from(changes).all()[0];
    expect(audit?.beforeJson).toBeNull();
    expect(JSON.parse(audit?.afterJson ?? "null")).toMatchObject({
      id,
      revision: 1,
      createdAt: "2026-10-17T12:00:00.000Z",
    });
  } finally {
    connection.sqlite.close();
  }
});
it("validates raw persisted rows before returning them", async () => {
  const { app, path } = await setup();
  const preview = app.previewAdd(cash);
  if (!preview.ok) throw new Error("Expected preview");
  app.commit(preview.value);
  const connection = openDatabase(path);
  try {
    const corruptions = [
      ["opening_date", "2026-02-30"],
      ["currency", "EUR"],
      ["kind", "unexpected"],
      ["opening_cents", 1.5],
      ["revision", 0],
      ["created_at", "2026-10-17"],
      ["created_at", "2026-10-17T12:00:00-05:00"],
      ["created_at", "2026-02-30T12:00:00.000Z"],
    ] as const;
    connection.sqlite.pragma("ignore_check_constraints = ON");
    for (const [column, value] of corruptions) {
      connection.sqlite
        .prepare(`UPDATE accounts SET ${column} = ? WHERE id = ?`)
        .run(value, preview.value.after.id);
      expect(() => app.list()).toThrow(/Invalid/);
      connection.db
        .update(accounts)
        .set(preview.value.after)
        .where(eq(accounts.id, preview.value.after.id))
        .run();
    }
  } finally {
    connection.sqlite.close();
  }
});
it("requires the latest schema before normal account operations", async () => {
  const { app, path } = await setup();
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)",
    );
  } finally {
    connection.sqlite.close();
  }
  expect(() => app.list()).toThrow("Database schema is out of date");
});
it("preserves original reconciliation evidence when an opening correction needs review", async () => {
  const { app, path } = await setup();
  const preview = app.previewAdd(cash);
  if (!preview.ok) throw new Error("Expected preview");
  app.commit(preview.value);
  const checks = createReconciliations(createReconciliationStore(path), {
    id: () => crypto.randomUUID(),
    now: () => "2026-10-17T12:00:00.000Z",
    today: () => "2026-10-17",
  });
  const check = checks.preview(preview.value.after.id, "2026-10-16", 12345);
  if (!check.ok) throw new Error("Expected reconciliation");
  checks.commit(check.value);
  const correction = app.previewOpening(preview.value.after.id, 1, 0, "2026-10-15");
  if (!correction.ok) throw new Error("Expected correction");
  expect(correction.value.affectedReconciliations).toEqual([
    { id: check.value.operationId, cutoffDate: "2026-10-16" },
  ]);
  expect(app.commit(correction.value).ok).toBe(true);
  expect(checks.list(preview.value.after.id)).toMatchObject({
    ok: true,
    value: [
      { status: "needs-review", openingCents: 12345, openingDate: "2026-10-16", entries: [] },
    ],
  });
});
it("rechecks immutable account fields and validated values before committing a preview", async () => {
  const { app } = await setup();
  const added = app.previewAdd(cash);
  if (!added.ok) throw new Error("Expected preview");
  app.commit(added.value);
  const renamed = app.previewRename(added.value.after.id, 1, "Synthetic renamed");
  if (!renamed.ok) throw new Error("Expected preview");
  if (renamed.value.after.kind === "tracking") throw new Error("Expected register account");
  const tampered = { ...renamed.value, after: { ...renamed.value.after, kind: "credit" as const } };
  expect(app.commit(tampered)).toEqual({ ok: false, reason: "invalid-account" });
  expect(
    app.commit({ ...renamed.value, after: { ...renamed.value.after, openingCents: 10 } }),
  ).toEqual({ ok: false, reason: "invalid-account" });
  expect(app.commit({ ...renamed.value, after: { ...renamed.value.after, name: " " } })).toEqual({
    ok: false,
    reason: "invalid-account",
  });
  expect(app.show(added.value.after.id)).toMatchObject({
    ok: true,
    value: { kind: "cash", revision: 1 },
  });
});
it("rejects opening corrections that overflow balances, including an entry added after preview", async () => {
  const { app, path } = await setup();
  const added = app.previewAdd(cash);
  if (!added.ok) throw new Error("Expected preview");
  app.commit(added.value);
  const id = added.value.after.id;
  const correction = app.previewOpening(id, 1, Number.MAX_SAFE_INTEGER, "2026-10-16");
  if (!correction.ok) throw new Error("Expected safe preview before activity");
  const connection = openDatabase(path);
  try {
    connection.sqlite
      .prepare("INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "synthetic-one-cent",
        id,
        "2026-10-17",
        "2026-10-17",
        1,
        "Synthetic",
        "",
        1,
        "2026-10-17T12:00:00.000Z",
        "2026-10-17T12:00:00.000Z",
      );
    expect(app.commit(correction.value)).toEqual({ ok: false, reason: "unsafe-cents" });
    expect(app.previewOpening(id, 1, Number.MAX_SAFE_INTEGER, "2026-10-16")).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    expect(app.show(id)).toMatchObject({ ok: true, value: { openingCents: 12345, revision: 1 } });
    expect(connection.db.select().from(changes).all()).toHaveLength(1);
  } finally {
    connection.sqlite.close();
  }
});
it("inspects account metadata and balances within one storage snapshot", async () => {
  const { app, path } = await setup();
  const added = app.previewAdd(cash);
  if (!added.ok) throw new Error("Expected preview");
  app.commit(added.value);
  const correction = app.previewOpening(added.value.after.id, 1, 20000, "2026-10-16");
  if (!correction.ok) throw new Error("Expected correction preview");
  const store = createAccountStore(path);
  let reads = 0;
  const inspected = createAccounts(
    {
      ...store,
      read: (work) => {
        reads++;
        const result = store.read(work);
        if (reads === 1) expect(app.commit(correction.value).ok).toBe(true);
        return result;
      },
    },
    { id: () => "unused", now: () => "2026-10-17T12:00:00.000Z", today: () => "2026-10-17" },
  );
  expect(inspected.inspect(added.value.after.id)).toMatchObject({
    ok: true,
    value: {
      account: { revision: 1, openingCents: 12345 },
      balances: { workingCents: 12345, clearedCents: 12345, unclearedCents: 0 },
    },
  });
  expect(reads).toBe(1);
  expect(app.inspect(added.value.after.id)).toMatchObject({
    ok: true,
    value: {
      account: { revision: 2, openingCents: 20000 },
      balances: { workingCents: 20000, clearedCents: 20000, unclearedCents: 0 },
    },
  });
});
