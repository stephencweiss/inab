import { afterEach, expect, it } from "vitest";
import { createAccounts } from "../../src/application/accounts.js";
import { createSnapshots } from "../../src/application/snapshots.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createSnapshotStore } from "../../src/storage/snapshots.js";
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
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const accounts = createAccounts(createAccountStore(fixture.path), runtime);
  const p = accounts.previewAdd({
    name: "Synthetic Tracking",
    kind: "tracking",
    currency: "USD",
    openingCents: null,
    openingDate: null,
  });
  if (!p.ok) throw new Error("Expected account");
  accounts.commit(p.value);
  let observedAt = runtime.now();
  const app = createSnapshots(createSnapshotStore(fixture.path), {
    ...runtime,
    now: () => observedAt,
  });
  return {
    ...fixture,
    accounts,
    app,
    id: p.value.after.id,
    setObservedAt: (value: string) => {
      observedAt = value;
    },
  };
}
it("uses the latest effective observation, preserves identity on correction, and survives restart", async () => {
  const { app, id, accounts, path, setObservedAt } = await setup();
  expect(accounts.inspect(id)).toMatchObject({
    ok: true,
    value: { latestSnapshot: null, balances: null },
  });
  const add = (date: string, cents: number) => {
    const p = app.previewAdd(id, date, cents);
    if (!p.ok) throw new Error("Expected preview");
    expect(app.commit(p.value).ok).toBe(true);
    return p.value.after;
  };
  add("2026-10-15", 500000);
  const latest = add("2026-10-16", 520000);
  setObservedAt("2026-10-17T13:00:00.000Z");
  add("2026-10-14", -123);
  add("2026-10-13", 0);
  expect(accounts.inspect(id)).toMatchObject({
    ok: true,
    value: {
      latestSnapshot: {
        id: latest.id,
        balanceCents: 520000,
        effectiveDate: "2026-10-16",
        source: "manual",
      },
    },
  });
  expect(accounts.list()).toMatchObject([
    { id, revision: 5, latestSnapshot: { balanceCents: 520000 } },
  ]);
  expect(app.previewAdd(id, "2026-10-16", 42)).toMatchObject({
    ok: false,
    reason: "same-date",
    existing: latest,
  });
  setObservedAt("2026-10-17T14:00:00.000Z");
  const corrected = app.previewCorrect(latest.id, 1, 530000);
  if (!corrected.ok) throw new Error("Expected correction");
  expect(app.commit(corrected.value).ok).toBe(true);
  expect(corrected.value.after.observedAt).toBe("2026-10-17T14:00:00.000Z");
  expect(corrected.value.after.observedAt).not.toBe(latest.observedAt);
  expect(createSnapshots(createSnapshotStore(path), runtime).list(id)).toMatchObject({
    ok: true,
    value: [
      { balanceCents: 0 },
      { balanceCents: -123 },
      { balanceCents: 500000 },
      {
        id: latest.id,
        accountId: id,
        effectiveDate: latest.effectiveDate,
        source: "manual",
        revision: 2,
        balanceCents: 530000,
      },
    ],
  });
  expect(app.previewCorrect(latest.id, 1, 1)).toEqual({ ok: false, reason: "stale-version" });
  const db = openDatabase(path);
  try {
    const row = db.sqlite
      .prepare("SELECT before_json FROM changes WHERE operation = 'snapshot.correct'")
      .get();
    expect(row).toEqual({ before_json: JSON.stringify(latest) });
  } finally {
    db.sqlite.close();
  }
});
it("rechecks account and snapshot versions and rolls back all writes on audit failure", async () => {
  const { app, id, accounts, path } = await setup();
  const a = app.previewAdd(id, "2026-10-16", 1);
  const b = app.previewAdd(id, "2026-10-15", 2);
  if (!a.ok || !b.ok) throw new Error("Expected previews");
  app.commit(a.value);
  expect(app.commit(b.value)).toEqual({ ok: false, reason: "stale-version" });
  const next = app.previewCorrect(a.value.after.id, 1, -5);
  if (!next.ok) throw new Error("Expected correction");
  const db = openDatabase(path);
  try {
    db.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() => app.commit(next.value)).toThrow(next.value.operationId);
  } finally {
    db.sqlite.close();
  }
  expect(app.list(id)).toMatchObject({ ok: true, value: [{ balanceCents: 1, revision: 1 }] });
  expect(accounts.show(id)).toMatchObject({ ok: true, value: { revision: 2 } });
});
it("refuses invalid values, future scheduling, missing IDs and non Tracking accounts", async () => {
  const { app, id, accounts } = await setup();
  expect(app.previewAdd(id, "2026-10-18", 1)).toEqual({ ok: false, reason: "future-date" });
  for (const [date, cents] of [
    ["2026-02-30", 0],
    ["2026-10-16", NaN],
    ["2026-10-16", 1.2],
  ] as const)
    expect(app.previewAdd(id, date, cents).ok).toBe(false);
  expect(app.list("missing")).toEqual({ ok: false, reason: "account-unavailable" });
  expect(app.previewCorrect("missing", 1, 0)).toEqual({
    ok: false,
    reason: "snapshot-unavailable",
  });
  for (const kind of ["cash", "credit"] as const) {
    const p = accounts.previewAdd({
      name: "Synthetic",
      kind,
      currency: "USD",
      openingCents: 0,
      openingDate: "2026-10-16",
    });
    if (!p.ok) throw new Error("Expected account");
    accounts.commit(p.value);
    expect(app.previewAdd(p.value.after.id, "2026-10-16", 0)).toEqual({
      ok: false,
      reason: "tracking-only",
    });
    expect(app.list(p.value.after.id)).toEqual({ ok: false, reason: "tracking-only" });
  }
});
it("keeps account list and inspection within one read when another connection writes", async () => {
  const { app, id, path, accounts } = await setup();
  for (const view of ["inspect", "list"] as const) {
    const before = accounts.show(id);
    if (!before.ok) throw new Error("Expected account");
    const add = app.previewAdd(id, view === "inspect" ? "2026-10-16" : "2026-10-17", 50);
    if (!add.ok) throw new Error("Expected add");
    let reads = 0;
    const store = createAccountStore(path);
    const reader = createAccounts(
      {
        ...store,
        read: (work) => {
          reads++;
          const result = store.read(work);
          expect(app.commit(add.value).ok).toBe(true);
          return result;
        },
      },
      runtime,
    );
    const result = view === "inspect" ? reader.inspect(id) : reader.list();
    if (view === "inspect")
      expect(result).toMatchObject({
        ok: true,
        value: { account: { revision: before.value.revision }, latestSnapshot: null },
      });
    else
      expect(result).toMatchObject([
        { id, revision: before.value.revision, latestSnapshot: { effectiveDate: "2026-10-16" } },
      ]);
    expect(reads).toBe(1);
    expect(accounts.inspect(id)).toMatchObject({
      ok: true,
      value: { account: { revision: before.value.revision + 1 }, latestSnapshot: add.value.after },
    });
  }
});
it("rolls additions back on audit failure and keeps observations out of registers and reconciliation", async () => {
  const { app, id, path, accounts } = await setup();
  const p = app.previewAdd(id, "2026-10-16", 0);
  if (!p.ok) throw new Error("Expected preview");
  const db = openDatabase(path);
  try {
    db.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() => app.commit(p.value)).toThrow(p.value.operationId);
    expect(app.list(id)).toEqual({ ok: true, value: [] });
    expect(accounts.show(id)).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM changes").get()).toEqual({ count: 1 });
    db.sqlite.exec("DROP TRIGGER fail_history");
    expect(app.commit(p.value).ok).toBe(true);
    for (const table of ["transactions", "reconciliations"])
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
  } finally {
    db.sqlite.close();
  }
});
it("accepts UTC clocks with seconds or milliseconds and rejects invalid clock values", async () => {
  const { path, id } = await setup();
  for (const clock of ["2026-10-17T12:00:00Z", "2026-10-17T12:00:00.001Z"]) {
    const app = createSnapshots(createSnapshotStore(path), { ...runtime, now: () => clock });
    const p = app.previewAdd(id, "2026-10-16", 0);
    expect(p.ok).toBe(true);
  }
  for (const clock of ["2026-02-30T12:00:00.000Z", "2026-10-17T12:00:00-05:00"]) {
    const app = createSnapshots(createSnapshotStore(path), { ...runtime, now: () => clock });
    expect(app.previewAdd(id, "2026-10-16", 0)).toEqual({ ok: false, reason: "invalid-snapshot" });
  }
});
it("holds an immediate writer lock and rejects stale previews from another application", async () => {
  const { app, id, path } = await setup();
  const p = app.previewAdd(id, "2026-10-16", 1);
  if (!p.ok) throw new Error("Expected preview");
  const other = createSnapshots(createSnapshotStore(path), runtime);
  const stale = other.previewAdd(id, "2026-10-16", 2);
  if (!stale.ok) throw new Error("Expected concurrent preview");
  expect(app.commit(p.value).ok).toBe(true);
  expect(other.commit(stale.value)).toEqual({ ok: false, reason: "stale-version" });
  const db = openDatabase(path);
  try {
    db.sqlite.pragma("busy_timeout = 1");
    createSnapshotStore(path).write(() => {
      expect(() =>
        db.sqlite.prepare("UPDATE accounts SET name = 'Synthetic locked' WHERE id = ?").run(id),
      ).toThrow(/locked/);
    });
  } finally {
    db.sqlite.close();
  }
});
it("validates persisted dates, amounts, sources, revisions and UTC timestamps", async () => {
  const { app, id, path } = await setup();
  const p = app.previewAdd(id, "2026-10-16", 0);
  if (!p.ok) throw new Error("Expected preview");
  app.commit(p.value);
  const db = openDatabase(path);
  try {
    db.sqlite.pragma("ignore_check_constraints = ON");
    for (const [column, value, original] of [
      ["effective_date", "2026-02-30", "2026-10-16"],
      ["balance_cents", 1.5, 0],
      ["source", "provider", "manual"],
      ["revision", 0, 1],
      ["observed_at", "2026-02-30T12:00:00.000Z", runtime.now()],
      ["observed_at", "2026-10-17T12:00:00-05:00", runtime.now()],
    ] as const) {
      db.sqlite.prepare(`UPDATE snapshots SET ${column} = ?`).run(value);
      expect(() => app.list(id)).toThrow(/Invalid/);
      db.sqlite.prepare(`UPDATE snapshots SET ${column} = ?`).run(original);
    }
  } finally {
    db.sqlite.close();
  }
});
it("rechecks immutable snapshot fields, safe values, revision limits and date policy at commit", async () => {
  const { app, id, path } = await setup();
  const p = app.previewAdd(id, "2026-10-16", 0);
  if (!p.ok) throw new Error("Expected preview");
  for (const patch of [
    { balanceCents: NaN },
    { effectiveDate: "2026-02-30" },
    { revision: 2 },
    { observedAt: "date" },
    { accountId: "other" },
  ])
    expect(app.commit({ ...p.value, after: { ...p.value.after, ...patch } })).toEqual({
      ok: false,
      reason: "invalid-snapshot",
    });
  expect(
    app.commit({ ...p.value, after: { ...p.value.after, effectiveDate: "2026-10-18" } }),
  ).toEqual({ ok: false, reason: "future-date" });
  app.commit(p.value);
  const correct = app.previewCorrect(p.value.after.id, 1, 1);
  if (!correct.ok) throw new Error("Expected correction");
  expect(
    app.commit({
      ...correct.value,
      after: { ...correct.value.after, effectiveDate: "2026-10-15" },
    }),
  ).toEqual({ ok: false, reason: "invalid-snapshot" });
  const db = openDatabase(path);
  try {
    db.sqlite.prepare("UPDATE snapshots SET revision = ?").run(Number.MAX_SAFE_INTEGER);
    expect(app.previewCorrect(p.value.after.id, Number.MAX_SAFE_INTEGER, 1)).toEqual({
      ok: false,
      reason: "invalid-snapshot",
    });
  } finally {
    db.sqlite.close();
  }
});
