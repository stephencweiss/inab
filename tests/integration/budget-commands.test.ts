import { afterEach, expect, it } from "vitest";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { budgetFixture } from "../helpers/budget.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function target() {
  const f = await budgetFixture();
  fixtures.push(f);
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const p = app.preview(
    {
      kind: "activate",
      facts: f.facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Checked",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    0,
  );
  if (!p.ok) throw new Error(p.reason);
  if (!app.commit(p.value).ok) throw new Error("activate failed");
  return { ...f, app, tx: createTransactions(createTransactionStore(f.path), f.runtime) };
}
it("sets assignments, refuses unfunded moves, and rechecks stale previews", async () => {
  const f = await target();
  const p = f.app.preview(
    { kind: "assign", month: "2026-10", categoryId: "food", amountCents: 20000 },
    1,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(f.app.commit(p.value).ok).toBe(true);
  expect(f.app.report("2026-10")).toMatchObject({
    ok: true,
    value: { month: { readyToAssignCents: 80000, categories: [{ availableCents: 20000 }] } },
  });
  expect(
    f.app.preview({ kind: "assign", month: "2026-11", categoryId: "food", amountCents: 90000 }, 2),
  ).toMatchObject({ ok: false, reason: "insufficient-funds" });
  expect(
    f.app.preview({ kind: "assign", month: "2026-10", categoryId: "food", amountCents: 10000 }, 1),
  ).toMatchObject({ ok: false, reason: "stale-version" });
});
it("old transaction commands advance budget revisions, preserve allocations on clearing, and guard amount edits", async () => {
  const f = await target();
  const p = f.tx.previewAdd(f.accountId, {
    occurredOn: "2026-10-02",
    postedOn: null,
    cents: -6000,
    payee: "Synthetic shop",
    memo: "",
  });
  if (!p.ok) throw new Error(p.reason);
  const save = f.tx.commit(p.value);
  if (!save.ok) throw new Error(save.reason);
  expect(f.app.inspect().state?.revision).toBe(2);
  expect(f.app.report("2026-10")).toMatchObject({
    ok: true,
    value: { month: { complete: false } },
  });
  expect(
    f.app.preview({ kind: "assign", month: "2026-10", categoryId: "food", amountCents: 100000 }, 2),
  ).toMatchObject({ ok: false, reason: "unallocated-activity" });
  const allocation = f.app.preview(
    {
      kind: "allocate",
      transactionId: save.value.transaction.id,
      expectedTransactionVersion: 1,
      allocation: { kind: "categories", lines: [{ categoryId: "food", amountCents: -6000 }] },
    },
    2,
  );
  if (!allocation.ok) throw new Error(allocation.reason);
  expect(f.app.commit(allocation.value).ok).toBe(true);
  const edit = f.tx.previewEdit(save.value.transaction.id, 1, {
    occurredOn: "2026-10-02",
    cents: -5000,
    payee: "Synthetic shop",
    memo: "",
  });
  expect(edit).toMatchObject({ ok: false, reason: "budget-allocation-replacement-required" });
  const clear = f.tx.previewClear(save.value.transaction.id, 1, "2026-10-03");
  if (!clear.ok) throw new Error(clear.reason);
  expect(f.tx.commit(clear.value).ok).toBe(true);
  expect(f.app.report("2026-10")).toMatchObject({
    ok: true,
    value: { month: { complete: true, categories: [{ activityCents: -6000 }] } },
  });
});
it("opening edits block reports until a reviewed amendment", async () => {
  const f = await target();
  const accounts = createAccounts(createAccountStore(f.path), f.runtime);
  const p = accounts.previewOpening(f.accountId, 1, 90000, "2026-09-30");
  if (!p.ok) throw new Error(p.reason);
  expect(accounts.commit(p.value).ok).toBe(true);
  expect(f.app.report("2026-11")).toEqual({ ok: false, reason: "opening-needs-review" });
});
it("keeps opening amendment reachable when a new account has manual activity", async () => {
  const f = await target();
  const accounts = createAccounts(createAccountStore(f.path), f.runtime),
    p = accounts.previewAdd({
      name: "New account",
      kind: "cash",
      currency: "USD",
      openingCents: 0,
      openingDate: "2026-10-31",
    });
  if (!p.ok) throw new Error(p.reason);
  const added = accounts.commit(p.value);
  if (!added.ok) throw new Error(added.reason);
  const tx = f.tx.previewAdd(added.value.account.id, {
    occurredOn: "2026-11-02",
    postedOn: null,
    cents: 100,
    payee: "Synthetic income",
    memo: "",
  });
  if (!tx.ok) throw new Error(tx.reason);
  expect(f.tx.commit(tx.value).ok).toBe(true);
  expect(f.app.inspect().state?.status).toBe("needs-review");
  expect(f.app.inspect().transactions).toHaveLength(1);
  expect(f.app.report("2026-11")).toEqual({ ok: false, reason: "opening-needs-review" });
  const snapshot = f.app.inspect();
  if (!snapshot.state) throw new Error("Missing budget");
  const facts = {
    ...snapshot.state.facts,
    opening: {
      ...snapshot.state.facts.opening,
      accounts: [
        ...snapshot.state.facts.opening.accounts,
        {
          accountId: added.value.account.id,
          kind: "cash" as const,
          balanceCents: 0,
          closed: false,
          evidence: "Account did not yet hold funds at boundary",
        },
      ],
    },
    events: [
      ...snapshot.state.facts.events,
      {
        kind: "transaction" as const,
        id: tx.value.after.id,
        sourceId: `live:${tx.value.after.id}`,
        date: "2026-11-02",
        order: 0,
        accountId: added.value.account.id,
        amountCents: 100,
        allocation: { kind: "income" as const },
      },
    ],
  };
  const amended = f.app.preview(
    {
      kind: "amend-opening",
      facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Reviewed new account and its income",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    snapshot.state.revision,
  );
  if (!amended.ok) throw new Error(amended.reason);
  expect(f.app.commit(amended.value).ok).toBe(true);
  expect(f.app.report("2026-11")).toMatchObject({
    ok: true,
    value: { status: "active", month: { readyToAssignCents: 100100, complete: true } },
  });
});
