import { afterEach, expect, it } from "vitest";
import { createAccounts } from "../../src/application/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createReconciliations } from "../../src/application/reconcile.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import type {
  AccountResult,
  TransactionResult,
  ReconciliationResult,
} from "../../src/application/ports.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
const runtime = {
  id: () => crypto.randomUUID(),
  now: () => "2026-10-17T12:00:00.000Z",
  today: () => "2026-10-17",
};
function value<T>(result: AccountResult<T> | TransactionResult<T> | ReconciliationResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
async function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const accounts = createAccounts(createAccountStore(f.path), runtime);
  const account = value(
    accounts.commit(
      value(
        accounts.previewAdd({
          name: "Synthetic",
          kind: "cash",
          currency: "USD",
          openingCents: 100000,
          openingDate: "2026-10-01",
        }),
      ),
    ),
  ).account;
  const tx = createTransactions(createTransactionStore(f.path), runtime);
  const input = {
    cents: -2500,
    occurredOn: "2026-10-04",
    postedOn: "2026-10-05",
    payee: "Synthetic",
    memo: "",
  };
  const entry = value(tx.commit(value(tx.previewAdd(account.id, input)))).transaction;
  const checks = createReconciliations(createReconciliationStore(f.path), runtime);
  const confirm = (date: string, cents: number) =>
    value(checks.commit(value(checks.preview(account.id, date, cents)))).reconciliation;
  const records = [
    confirm("2026-10-03", 100000),
    confirm("2026-10-10", 97500),
    confirm("2026-10-17", 97500),
  ];
  return { ...f, accounts, account, tx, input, entry, checks, confirm, records };
}
for (const action of [
  "amount",
  "posting",
  "unclear",
  "insert",
  "opening",
  "opening-date",
] as const) {
  it(`marks affected later checks for review after ${action}, preserving original evidence`, async () => {
    const f = await setup();
    const affected = f.records
      .slice(action.startsWith("opening") ? 0 : 1)
      .map(({ id, cutoffDate }) => ({ id, cutoffDate }));
    if (action === "opening" || action === "opening-date") {
      const p = value(
        f.accounts.previewOpening(
          f.account.id,
          2,
          action === "opening" ? 100100 : 100000,
          action === "opening" ? "2026-10-01" : "2026-10-02",
        ),
      );
      expect(p).toMatchObject({ affectedReconciliations: affected });
      value(f.accounts.commit(p));
    } else {
      const previews = {
        amount: () => f.tx.previewEdit(f.entry.id, 1, { ...f.input, cents: -2600 }),
        posting: () => f.tx.previewClear(f.entry.id, 1, "2026-10-12"),
        unclear: () => f.tx.previewUnclear(f.entry.id, 1),
        insert: () => f.tx.previewAdd(f.account.id, { ...f.input, cents: -100 }),
      };
      const p = value(previews[action]());
      expect(p).toMatchObject({ affectedReconciliations: affected });
      value(f.tx.commit(p));
    }
    const actual = value(f.checks.list(f.account.id));
    expect(actual).toEqual(
      f.records.map((r, i) => ({
        ...r,
        status: action.startsWith("opening") || i > 0 ? "needs-review" : "valid",
      })),
    );
    const c = openDatabase(f.path);
    try {
      expect(
        c.sqlite.prepare("SELECT id FROM reconciliations WHERE status = 'needs-review'").all(),
      ).toHaveLength(affected.length);
      const audit = c.sqlite
        .prepare(
          "SELECT before_json, after_json FROM changes WHERE operation = 'reconciliation.invalidate'",
        )
        .all();
      expect(audit).toHaveLength(affected.length);
      expect(JSON.stringify(audit)).toContain("needs-review");
      expect(JSON.stringify(audit)).toContain("valid");
    } finally {
      c.sqlite.close();
    }
    const total = value(f.tx.register(f.account.id)).balances.clearedCents;
    const next = f.confirm("2026-10-17", total);
    expect(next.status).toBe("valid");
    expect(
      value(f.checks.list(f.account.id)).filter((r) => r.status === "needs-review"),
    ).toHaveLength(affected.length);
  });
}
it("keeps metadata, occurrence-only, pending and after-cutoff changes valid", async () => {
  const f = await setup();
  for (const input of [
    { ...f.input, payee: "Corrected", memo: "Details" },
    { ...f.input, occurredOn: "2026-10-03" },
  ]) {
    const current = value(f.tx.register(f.account.id)).entries.find((e) => e.id === f.entry.id)!;
    const p = value(f.tx.previewEdit(current.id, current.revision, input));
    expect(p).toMatchObject({ affectedReconciliations: [] });
    value(f.tx.commit(p));
  }
  value(
    f.tx.commit(value(f.tx.previewAdd(f.account.id, { ...f.input, postedOn: null, cents: -100 }))),
  );
  expect(value(f.checks.list(f.account.id))).toEqual(f.records);
  const p = value(
    f.tx.previewAdd(f.account.id, {
      ...f.input,
      occurredOn: "2026-10-12",
      postedOn: "2026-10-12",
      cents: -100,
    }),
  );
  expect(p).toMatchObject({
    affectedReconciliations: [{ id: f.records[2]!.id, cutoffDate: "2026-10-17" }],
  });
  value(f.tx.commit(p));
  expect(value(f.checks.list(f.account.id)).map((r) => r.status)).toEqual([
    "valid",
    "valid",
    "needs-review",
  ]);
});
it("invalidates posting changes within a cutoff and never heals old checks when values return", async () => {
  const f = await setup();
  value(f.tx.commit(value(f.tx.previewClear(f.entry.id, 1, "2026-10-06"))));
  value(f.tx.commit(value(f.tx.previewClear(f.entry.id, 2, "2026-10-05"))));
  expect(value(f.checks.list(f.account.id)).map((r) => r.status)).toEqual([
    "valid",
    "needs-review",
    "needs-review",
  ]);
  expect(value(f.tx.register(f.account.id)).entries[0]!.clearance).toBe("cleared");
});
it("keeps rename and unchanged opening valid and still rejects an opening over posted entries", async () => {
  const f = await setup();
  value(f.accounts.commit(value(f.accounts.previewRename(f.account.id, 2, "New name"))));
  const p = value(f.accounts.previewOpening(f.account.id, 3, 100000, "2026-10-01"));
  expect(p).toMatchObject({ affectedReconciliations: [] });
  value(f.accounts.commit(p));
  expect(value(f.checks.list(f.account.id))).toEqual(f.records);
  expect(f.accounts.previewOpening(f.account.id, 4, 100000, "2026-10-05")).toEqual({
    ok: false,
    reason: "posting-in-opening-period",
  });
});
it("rejects stale corrections from another connection and newly confirmed checks absent from approval", async () => {
  const f = await setup();
  const p = value(f.tx.previewUnclear(f.entry.id, 1));
  const opening = value(f.accounts.previewOpening(f.account.id, 2, 100100, "2026-10-01"));
  f.confirm("2026-10-12", 97500);
  expect(f.tx.commit(p)).toEqual({ ok: false, reason: "stale-version" });
  expect(f.accounts.commit(opening)).toEqual({ ok: false, reason: "stale-version" });
  const fresh = value(f.tx.previewUnclear(f.entry.id, 1));
  const other = createTransactions(createTransactionStore(f.path), runtime);
  value(
    other.commit(value(other.previewEdit(f.entry.id, 1, { ...f.input, memo: "Other connection" }))),
  );
  expect(f.tx.commit(fresh)).toEqual({ ok: false, reason: "stale-version" });
  expect(value(f.checks.list(f.account.id)).every((r) => r.status === "valid")).toBe(true);
});
for (const operation of ["transaction", "account"] as const) {
  it(`rolls back ${operation} invalidation, mutation and history after failure`, async () => {
    const f = await setup();
    const c = openDatabase(f.path);
    const dump = () =>
      ["accounts", "transactions", "reconciliations", "reconciliation_entries", "changes"].map(
        (t) => c.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all(),
      );
    try {
      const before = dump();
      c.sqlite.exec(
        `CREATE TRIGGER fail_correction BEFORE UPDATE ON ${operation === "account" ? "accounts" : "transactions"} BEGIN SELECT CASE WHEN (SELECT count(*) FROM reconciliations WHERE status = 'needs-review') > 0 THEN RAISE(ABORT, 'after invalidation') ELSE RAISE(ABORT, 'invalidation missing') END; END`,
      );
      if (operation === "account") {
        const p = value(f.accounts.previewOpening(f.account.id, 2, 100100, "2026-10-01"));
        expect(() => f.accounts.commit(p)).toThrow("after invalidation");
      } else {
        const p = value(f.tx.previewUnclear(f.entry.id, 1));
        expect(() => f.tx.commit(p)).toThrow("after invalidation");
      }
      expect(dump()).toEqual(before);
    } finally {
      c.sqlite.close();
    }
  });
}
