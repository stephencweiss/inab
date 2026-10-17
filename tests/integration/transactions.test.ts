import { createReconciliations } from "../../src/application/reconcile.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { afterEach, expect, it } from "vitest";
import { createAccounts } from "../../src/application/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
const runtime = {
  id: () => crypto.randomUUID(),
  now: () => "2026-10-17T12:00:00.000Z",
  today: () => "2026-10-17",
};
async function setup(openingCents = 100000) {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const accounts = createAccounts(createAccountStore(fixture.path), runtime);
  const added = accounts.previewAdd({
    name: "Synthetic",
    kind: "cash",
    currency: "USD",
    openingCents,
    openingDate: "2026-10-16",
  });
  if (!added.ok) throw new Error("Expected account");
  accounts.commit(added.value);
  return {
    ...fixture,
    id: added.value.after.id,
    app: createTransactions(createTransactionStore(fixture.path), runtime),
    accounts,
  };
}
const entry = {
  occurredOn: "2026-10-17",
  postedOn: null,
  cents: -6000,
  payee: "Synthetic shop",
  memo: "",
};
it("keeps separate purchases, corrects metadata and amounts, and clears with optimistic revisions", async () => {
  const { app, id } = await setup();
  const first = app.previewAdd(id, entry);
  if (!first.ok) throw new Error("Expected preview");
  expect(app.commit(first.value).ok).toBe(true);
  const second = app.previewAdd(id, entry);
  if (!second.ok) throw new Error("Expected preview");
  app.commit(second.value);
  expect(second.value.after.id).not.toBe(first.value.after.id);
  const edit = app.previewEdit(first.value.after.id, 1, {
    ...entry,
    cents: -2500,
    memo: "Correction",
    payee: "Changed",
  });
  if (!edit.ok) throw new Error("Expected edit");
  app.commit(edit.value);
  expect(app.previewClear(first.value.after.id, 1, "2026-10-17")).toEqual({
    ok: false,
    reason: "stale-version",
  });
  const clear = app.previewClear(first.value.after.id, 2, "2026-10-17");
  if (!clear.ok) throw new Error("Expected clear");
  app.commit(clear.value);
  expect(app.register(id)).toMatchObject({
    ok: true,
    value: { balances: { workingCents: 91500, clearedCents: 97500, unclearedCents: -6000 } },
  });
  const unclear = app.previewUnclear(first.value.after.id, 3);
  if (!unclear.ok) throw new Error("Expected unclear");
  app.commit(unclear.value);
  expect(app.register(id)).toMatchObject({
    ok: true,
    value: { balances: { clearedCents: 100000, unclearedCents: -8500 } },
  });
});
it("rejects invalid dates, unsafe totals, stale previews, and rolls back an audit failure", async () => {
  const { app, id, path, accounts } = await setup(Number.MAX_SAFE_INTEGER);
  expect(app.previewAdd(id, { ...entry, cents: 1 })).toEqual({ ok: false, reason: "unsafe-cents" });
  for (const input of [
    { ...entry, cents: 0 },
    { ...entry, occurredOn: "2026-02-30" },
    { ...entry, payee: " " },
  ])
    expect(app.previewAdd(id, input).ok).toBe(false);
  expect(app.previewAdd(id, { ...entry, occurredOn: "2026-10-18" })).toEqual({
    ok: false,
    reason: "future-date",
  });
  expect(
    app.previewAdd(id, { ...entry, occurredOn: "2026-10-15", postedOn: "2026-10-16" }),
  ).toEqual({ ok: false, reason: "posting-in-opening-period" });
  const a = app.previewAdd(id, entry);
  const b = app.previewAdd(id, entry);
  if (!a.ok || !b.ok) throw new Error("Expected previews");
  app.commit(a.value);
  expect(app.commit(b.value)).toEqual({ ok: false, reason: "stale-version" });
  const next = app.previewAdd(id, entry);
  if (!next.ok) throw new Error("Expected preview");
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() => app.commit(next.value)).toThrow(next.value.operationId);
  } finally {
    connection.sqlite.close();
  }
  expect(app.register(id)).toMatchObject({
    ok: true,
    value: { entries: [expect.objectContaining({ id: a.value.after.id })] },
  });
  expect(accounts.show(id)).toMatchObject({ ok: true, value: { revision: 2 } });
});
it("allows old pending purchases, revalidates posting dates on correction, and keeps immutable metadata", async () => {
  const { app, id } = await setup();
  const old = app.previewAdd(id, { ...entry, occurredOn: "2026-10-15" });
  if (!old.ok) throw new Error("Expected old pending purchase");
  app.commit(old.value);
  expect(app.previewClear(old.value.after.id, 1, "2026-10-16")).toEqual({
    ok: false,
    reason: "posting-in-opening-period",
  });
  const cleared = app.previewClear(old.value.after.id, 1, "2026-10-17");
  if (!cleared.ok) throw new Error("Expected clearing");
  app.commit(cleared.value);
  expect(app.previewEdit(old.value.after.id, 2, { ...entry, occurredOn: "2026-10-18" }).ok).toBe(
    false,
  );
  const corrected = app.previewEdit(old.value.after.id, 2, {
    ...entry,
    occurredOn: "2026-10-16",
    cents: -123,
    payee: "Changed",
    memo: "Correction",
  });
  if (!corrected.ok) throw new Error("Expected correction");
  expect(corrected.value.after).toMatchObject({
    id: old.value.after.id,
    accountId: id,
    createdAt: old.value.after.createdAt,
    postedOn: "2026-10-17",
    revision: 3,
  });
  app.commit(corrected.value);
  expect(app.register(id)).toMatchObject({
    ok: true,
    value: { balances: { workingCents: 99877, clearedCents: 99877, unclearedCents: 0 } },
  });
  expect(app.previewAdd(id, { ...entry, postedOn: "2026-10-18" })).toEqual({
    ok: false,
    reason: "future-date",
  });
  expect(
    app.previewAdd(id, { ...entry, occurredOn: "2026-10-17", postedOn: "2026-10-15" }).ok,
  ).toBe(false);
});
it("rejects overflow in cleared and uncleared totals even if the working total is safe", async () => {
  const { app, id, path } = await setup(0);
  const connection = openDatabase(path);
  try {
    const insert = connection.sqlite.prepare(
      "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const put = (key: string, cents: number, posted: string | null) =>
      insert.run(
        key,
        id,
        "2026-10-17",
        posted,
        cents,
        "Synthetic",
        "",
        1,
        runtime.now(),
        runtime.now(),
      );
    put("a", Number.MAX_SAFE_INTEGER, "2026-10-17");
    put("b", -Number.MAX_SAFE_INTEGER, null);
    expect(app.previewAdd(id, { ...entry, cents: 1, postedOn: "2026-10-17" })).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    connection.sqlite.exec("DELETE FROM transactions");
    put("a", -Number.MAX_SAFE_INTEGER, "2026-10-17");
    put("b", Number.MAX_SAFE_INTEGER, null);
    expect(app.previewAdd(id, { ...entry, cents: 1 })).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    expect(connection.sqlite.prepare("SELECT COUNT(*) AS count FROM transactions").get()).toEqual({
      count: 2,
    });
  } finally {
    connection.sqlite.close();
  }
});
it("keeps metadata valid and previews review for balance corrections", async () => {
  const { app, id, path } = await setup();
  const added = app.previewAdd(id, { ...entry, postedOn: "2026-10-17" });
  if (!added.ok) throw new Error("Expected posted");
  app.commit(added.value);
  const checks = createReconciliations(createReconciliationStore(path), runtime);
  const check = checks.preview(id, "2026-10-17", 94000);
  if (!check.ok) throw new Error("Expected reconciliation");
  checks.commit(check.value);
  for (const correction of [
    app.previewUnclear(added.value.after.id, 1),
    app.previewEdit(added.value.after.id, 1, { ...entry, cents: -1 }),
  ]) {
    expect(correction).toMatchObject({
      ok: true,
      value: {
        affectedReconciliations: [{ id: check.value.operationId, cutoffDate: "2026-10-17" }],
      },
    });
  }
  const metadata = app.previewEdit(added.value.after.id, 1, {
    ...entry,
    memo: "Details",
    payee: "Changed",
  });
  if (!metadata.ok) throw new Error("Expected metadata edit");
  expect(app.commit(metadata.value).ok).toBe(true);
  expect(checks.list(id)).toMatchObject({
    ok: true,
    value: [{ status: "valid", entries: [{ transactionRevision: 1 }] }],
  });
  expect(app.previewAdd(id, entry)).toMatchObject({
    ok: true,
    value: { affectedReconciliations: [] },
  });
});
it("uses one read snapshot and sorts injected timestamp ties by ID", async () => {
  const { id, path } = await setup();
  let next = 0;
  const app = createTransactions(createTransactionStore(path), {
    ...runtime,
    id: () => ["z", "op-z", "a", "op-a"][next++] ?? "unused",
  });
  for (let index = 0; index < 2; index++) {
    const preview = app.previewAdd(id, entry);
    if (!preview.ok) throw new Error("Expected preview");
    app.commit(preview.value);
  }
  const store = createTransactionStore(path);
  let reads = 0;
  const inspected = createTransactions(
    {
      ...store,
      read: (work) => {
        reads++;
        return store.read(work);
      },
    },
    runtime,
  );
  const register = inspected.register(id);
  if (!register.ok) throw new Error("Expected register");
  expect(register.value.entries.map((e) => e.id)).toEqual(["a", "z"]);
  expect(reads).toBe(1);
});
it("sorts timestamps by time when stored precision differs", async () => {
  const { path, id, app } = await setup();
  const connection = openDatabase(path);
  try {
    const insert = connection.sqlite.prepare(
      "INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "a-later",
      id,
      "2026-10-17",
      null,
      -1,
      "Synthetic",
      "",
      1,
      "2026-10-17T12:00:00.001Z",
      runtime.now(),
    );
    insert.run(
      "z-earlier",
      id,
      "2026-10-17",
      null,
      -1,
      "Synthetic",
      "",
      1,
      "2026-10-17T12:00:00Z",
      runtime.now(),
    );
  } finally {
    connection.sqlite.close();
  }
  const result = app.register(id);
  if (!result.ok) throw new Error("Expected register");
  expect(result.value.entries.map((e) => e.id)).toEqual(["z-earlier", "a-later"]);
});
it("keeps account inspection and register totals consistent after corrections reorder sums", async () => {
  const { app, accounts, id } = await setup(0);
  const make = (occurredOn: string, cents: number) => {
    const p = app.previewAdd(id, { ...entry, occurredOn, cents });
    if (!p.ok) throw new Error("Expected add");
    app.commit(p.value);
    return p.value.after.id;
  };
  const first = make("2026-10-17", 1);
  make("2026-10-17", Number.MAX_SAFE_INTEGER - 1);
  make("2026-10-15", -Number.MAX_SAFE_INTEGER);
  const edit = app.previewEdit(first, 1, { ...entry, cents: 2 });
  if (!edit.ok) throw new Error("Expected safe sorted correction");
  app.commit(edit.value);
  expect(app.register(id)).toMatchObject({ ok: true, value: { balances: { workingCents: 1 } } });
  expect(accounts.inspect(id)).toMatchObject({
    ok: true,
    value: { balances: { workingCents: 1 } },
  });
});
