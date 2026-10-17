import { afterEach, expect, it } from "vitest";
import { createAccounts } from "../../src/application/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createReconciliations } from "../../src/application/reconcile.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
const runtime = {
  id: () => crypto.randomUUID(),
  now: () => "2026-10-17T12:00:00.000Z",
  today: () => "2026-10-17",
};
async function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const accounts = createAccounts(createAccountStore(f.path), runtime);
  const added = accounts.previewAdd({
    name: "Synthetic",
    kind: "cash",
    currency: "USD",
    openingCents: 100000,
    openingDate: "2026-10-16",
  });
  if (!added.ok) throw new Error("Expected account");
  accounts.commit(added.value);
  const id = added.value.after.id;
  const tx = createTransactions(createTransactionStore(f.path), runtime);
  const add = (cents: number, postedOn: string | null) => {
    const p = tx.previewAdd(id, {
      cents,
      postedOn,
      occurredOn: "2026-10-17",
      payee: "Synthetic",
      memo: "",
    });
    if (!p.ok) throw new Error("Expected transaction");
    tx.commit(p.value);
    return p.value.after;
  };
  const pending = add(-6000, null);
  const posted = add(-2500, "2026-10-17");
  return {
    ...f,
    id,
    tx,
    add,
    pending,
    posted,
    app: createReconciliations(createReconciliationStore(f.path), runtime),
  };
}
it("records evidence atomically, repeats safely, preserves coverage after metadata changes and leaves pending alone", async () => {
  const { app, id, tx, posted, path } = await setup();
  const mismatch = app.preview(id, "2026-10-17", 97000);
  if (!mismatch.ok) throw new Error("Expected comparison");
  expect(app.commit(mismatch.value)).toEqual({ ok: false, reason: "balance-mismatch" });
  expect(app.list(id)).toMatchObject({ ok: true, value: [] });
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  expect(app.commit(p.value)).toMatchObject({
    ok: true,
    value: {
      reconciliation: {
        accountRevision: 3,
        status: "valid",
        entries: [{ transactionId: posted.id, transactionRevision: 1 }],
      },
    },
  });
  expect(app.commit(p.value)).toMatchObject({
    ok: true,
    value: { reused: true, operationId: null, reconciliation: { id: p.value.operationId } },
  });
  const connection = openDatabase(path);
  try {
    expect(connection.sqlite.prepare("SELECT count(*) AS n FROM reconciliations").get()).toEqual({
      n: 1,
    });
    expect(
      connection.sqlite.prepare("SELECT count(*) AS n FROM reconciliation_entries").get(),
    ).toEqual({ n: 1 });
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS n FROM changes WHERE operation = 'reconciliation.confirm'")
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    connection.sqlite.close();
  }
  const edit = tx.previewEdit(posted.id, 1, {
    cents: -2500,
    occurredOn: "2026-10-17",
    payee: "Corrected",
    memo: "Details",
  });
  if (!edit.ok) throw new Error("Expected edit");
  tx.commit(edit.value);
  expect(tx.register(id)).toMatchObject({
    ok: true,
    value: {
      entries: expect.arrayContaining([
        expect.objectContaining({ id: posted.id, clearance: "reconciled" }),
        expect.objectContaining({ postedOn: null, clearance: "uncleared" }),
      ]),
    },
  });
  expect(app.list(id)).toMatchObject({
    ok: true,
    value: [{ status: "valid", entries: [{ transactionRevision: 1 }] }],
  });
});
it("rejects stale and forged previews and rolls back reconciliation and evidence when audit fails", async () => {
  const { app, id, add, path } = await setup();
  const stale = app.preview(id, "2026-10-17", 97500);
  if (!stale.ok) throw new Error("Expected preview");
  add(-1, null);
  expect(app.commit(stale.value)).toEqual({ ok: false, reason: "stale-version" });
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  expect(app.commit({ ...p.value, accountId: "other" }).ok).toBe(false);
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
  } finally {
    connection.sqlite.close();
  }
  expect(() => app.commit(p.value)).toThrow(p.value.operationId);
  expect(app.list(id)).toMatchObject({ ok: true, value: [] });
});
it("rejects unavailable accounts, future cutoffs and Tracking with a clear reason", async () => {
  const { app, id, path } = await setup();
  expect(app.preview("missing", "2026-10-17", 0)).toEqual({
    ok: false,
    reason: "account-unavailable",
  });
  expect(app.preview(id, "2026-10-18", 97500)).toEqual({ ok: false, reason: "future-date" });
  const accounts = createAccounts(createAccountStore(path), runtime);
  const a = accounts.previewAdd({
    name: "Synthetic tracking",
    kind: "tracking",
    currency: "USD",
    openingCents: null,
    openingDate: null,
  });
  if (!a.ok) throw new Error("Expected account");
  accounts.commit(a.value);
  expect(app.preview(a.value.after.id, "2026-10-17", 0)).toEqual({
    ok: false,
    reason: "tracking-register",
  });
});
it("refuses date-only preview timestamps before writing", async () => {
  const { app, id } = await setup();
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  expect(app.commit({ ...p.value, recordedAt: "2026-10-17" })).toEqual({
    ok: false,
    reason: "invalid-reconciliation",
  });
  expect(app.list(id)).toMatchObject({ ok: true, value: [] });
});
it("derives needs-review from changed values and does not show stale coverage", async () => {
  const { app, id, tx, path, posted } = await setup();
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  const saved = app.commit(p.value);
  if (!saved.ok) throw new Error("Expected confirmation");
  const connection = openDatabase(path);
  try {
    connection.sqlite.prepare("UPDATE transactions SET cents = -2501 WHERE id = ?").run(posted.id);
  } finally {
    connection.sqlite.close();
  }
  expect(app.list(id)).toMatchObject({
    ok: true,
    value: [{ status: "needs-review", entries: [{ cents: -2500, transactionRevision: 1 }] }],
  });
  expect(tx.register(id)).toMatchObject({
    ok: true,
    value: {
      entries: expect.arrayContaining([
        expect.objectContaining({ id: posted.id, clearance: "cleared" }),
      ]),
    },
  });
  const next = app.preview(id, "2026-10-17", 97499);
  if (!next.ok) throw new Error("Expected preview");
  expect(app.commit(next.value)).toEqual({ ok: false, reason: "invalid-reconciliation" });
});
it("rolls back the reconciliation if evidence insert fails and holds an immediate write lock", async () => {
  const { app, id, path } = await setup();
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "CREATE TRIGGER fail_evidence BEFORE INSERT ON reconciliation_entries BEGIN SELECT RAISE(ABORT, 'synthetic evidence failure'); END",
    );
    expect(() => app.commit(p.value)).toThrow(p.value.operationId);
    expect(
      connection.sqlite.prepare("SELECT count(*) AS n FROM reconciliation_entries").get(),
    ).toEqual({ n: 0 });
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS n FROM changes WHERE operation = 'reconciliation.confirm'")
        .get(),
    ).toEqual({ n: 0 });
    connection.sqlite.pragma("busy_timeout = 1");
    createReconciliationStore(path).write(() => {
      expect(() =>
        connection.sqlite
          .prepare("UPDATE accounts SET name = 'Synthetic locked' WHERE id = ?")
          .run(id),
      ).toThrow(/locked/);
    });
  } finally {
    connection.sqlite.close();
  }
  expect(app.list(id)).toMatchObject({ ok: true, value: [] });
});
it("reads reconciliation coverage and register values in one snapshot", async () => {
  const { app, id, path } = await setup();
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  app.commit(p.value);
  const store = createTransactionStore(path);
  let reads = 0;
  const tx = createTransactions(
    {
      ...store,
      read: (work) => {
        reads++;
        return store.read((session) => {
          let entriesRead = false;
          return work({
            ...session,
            entries: (key) => {
              entriesRead = true;
              return session.entries(key);
            },
            reconciliations: (key) => {
              expect(entriesRead).toBe(true);
              return session.reconciliations(key);
            },
          });
        });
      },
    },
    runtime,
  );
  expect(tx.register(id)).toMatchObject({
    ok: true,
    value: {
      entries: expect.arrayContaining([expect.objectContaining({ clearance: "reconciled" })]),
    },
  });
  expect(reads).toBe(1);
});
it("rejects corrupt stored timestamps and evidence values at the storage boundary", async () => {
  const { app, id, path } = await setup();
  const p = app.preview(id, "2026-10-17", 97500);
  if (!p.ok) throw new Error("Expected preview");
  app.commit(p.value);
  const connection = openDatabase(path);
  try {
    connection.sqlite.prepare("UPDATE reconciliations SET recorded_at = ?").run("2026-10-17");
    expect(() => app.list(id)).toThrow("Invalid database timestamp");
    connection.sqlite.prepare("UPDATE reconciliations SET recorded_at = ?").run(runtime.now());
    connection.sqlite.prepare("UPDATE reconciliation_entries SET posted_on = ?").run("2026-02-30");
    expect(() => app.list(id)).toThrow("Invalid reconciliation evidence");
  } finally {
    connection.sqlite.close();
  }
});
