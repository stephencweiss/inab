import { afterEach, expect, it } from "vitest";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { budgetFixture } from "../helpers/budget.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("keeps the reviewed budget date of an old pending purchase when clearing", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const tx = createTransactions(createTransactionStore(f.path), f.runtime);
  const added = tx.previewAdd(f.accountId, {
    occurredOn: "2026-09-29",
    postedOn: null,
    cents: -6000,
    payee: "Old pending",
    memo: "",
  });
  if (!added.ok) throw new Error(added.reason);
  const saved = tx.commit(added.value);
  if (!saved.ok) throw new Error(saved.reason);
  const id = saved.value.transaction.id;
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const facts = {
    ...f.facts,
    events: [
      {
        kind: "transaction" as const,
        id,
        sourceId: `live:${id}`,
        date: "2026-10-01",
        order: 0,
        accountId: f.accountId,
        amountCents: -6000,
        allocation: {
          kind: "categories" as const,
          lines: [{ categoryId: "food", amountCents: -6000 }],
        },
      },
    ],
  };
  const p = app.preview(
    {
      kind: "activate",
      facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Reviewed pending treatment",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    0,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(app.commit(p.value).ok).toBe(true);
  const clear = tx.previewClear(id, 1, "2026-10-02");
  if (!clear.ok) throw new Error(clear.reason);
  expect(tx.commit(clear.value).ok).toBe(true);
  expect(app.inspect().state?.facts.events[0]?.date).toBe("2026-10-01");
  expect(app.report("2026-10").ok).toBe(true);
});
it.each(["into-opening", "out-of-opening"])(
  "keeps amendments reachable after a date moves %s",
  async (direction) => {
    const f = await budgetFixture();
    fixtures.push(f);
    const tx = createTransactions(createTransactionStore(f.path), f.runtime);
    const before = direction === "into-opening" ? "2026-10-02" : "2026-09-29",
      after = direction === "into-opening" ? "2026-09-29" : "2026-10-02";
    const added = tx.previewAdd(f.accountId, {
      occurredOn: before,
      postedOn: null,
      cents: -6000,
      payee: "Pending",
      memo: "",
    });
    if (!added.ok) throw new Error(added.reason);
    const saved = tx.commit(added.value);
    if (!saved.ok) throw new Error(saved.reason);
    const id = saved.value.transaction.id;
    const facts = {
      ...f.facts,
      opening:
        direction === "out-of-opening"
          ? {
              ...f.facts.opening,
              accounts: f.facts.opening.accounts.map((a) => ({ ...a, balanceCents: 94000 })),
              readyToAssignCents: 94000,
            }
          : f.facts.opening,
      events:
        direction === "into-opening"
          ? [
              {
                kind: "transaction" as const,
                id,
                sourceId: `live:${id}`,
                date: before,
                order: 0,
                accountId: f.accountId,
                amountCents: -6000,
                allocation: { kind: "income" as const },
              },
            ]
          : [],
    };
    const app = createBudget(createBudgetStore(f.path), f.runtime);
    const p = app.preview(
      {
        kind: "activate",
        facts,
        coverage: {
          throughDate: "2026-11-05",
          evidence: "Reviewed boundary",
          includedTransactionIds: direction === "out-of-opening" ? [id] : [],
          postedBridgeEventIds: [],
        },
      },
      0,
    );
    if (!p.ok) throw new Error(p.reason);
    expect(app.commit(p.value).ok).toBe(true);
    const edit = tx.previewEdit(id, 1, {
      occurredOn: after,
      cents: -6000,
      payee: "Pending",
      memo: "",
    });
    if (!edit.ok) throw new Error(edit.reason);
    expect(tx.commit(edit.value).ok).toBe(true);
    expect(app.inspect().state?.status).toBe("needs-review");
    expect(app.report("2026-10")).toEqual({ ok: false, reason: "opening-needs-review" });
  },
);
it("verifies a later register opening bridge and refuses an unbalanced historical correction", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const accounts = createAccounts(createAccountStore(f.path), f.runtime);
  const opening = accounts.previewOpening(f.accountId, 1, 94000, "2026-10-31");
  if (!opening.ok) throw new Error(opening.reason);
  expect(accounts.commit(opening.value).ok).toBe(true);
  const event = {
    kind: "transaction" as const,
    id: "history",
    sourceId: "manual:history",
    accountId: f.accountId,
    date: "2026-10-10",
    order: 0,
    amountCents: -6000,
    allocation: {
      kind: "categories" as const,
      lines: [{ categoryId: "food", amountCents: -6000 }],
    },
  };
  const facts = { ...f.facts, events: [event] };
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const p = app.preview(
    {
      kind: "activate",
      facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Synthetic boundary bridge",
        includedTransactionIds: [],
        postedBridgeEventIds: ["history"],
      },
    },
    0,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(app.commit(p.value).ok).toBe(true);
  expect(app.report("2026-11")).toMatchObject({
    ok: true,
    value: { month: { readyToAssignCents: 94000 } },
  });
  expect(
    app.preview(
      {
        kind: "historical-correct",
        expectedActivityVersion: 1,
        event: {
          ...event,
          amountCents: -5000,
          allocation: { kind: "categories", lines: [{ categoryId: "food", amountCents: -5000 }] },
        },
      },
      1,
    ),
  ).toMatchObject({ ok: false, reason: "opening-amendment-required" });
});
it("refuses a transfer to a nonexistent external account before writing", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const facts = {
    ...f.facts,
    events: [
      {
        kind: "transfer" as const,
        id: "bad",
        sourceId: "manual:bad",
        date: "2026-10-10",
        order: 0,
        fromAccountId: f.accountId,
        toAccountId: "missing",
        amountCents: 100,
        categoryId: "food",
      },
    ],
  };
  expect(
    app.preview(
      {
        kind: "activate",
        facts,
        coverage: {
          throughDate: "2026-11-05",
          evidence: "Checked",
          includedTransactionIds: [],
          postedBridgeEventIds: [],
        },
      },
      0,
    ),
  ).toMatchObject({ ok: false, reason: "account-unavailable" });
});
