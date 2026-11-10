import { afterEach, expect, it } from "vitest";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { budgetFixture } from "../helpers/budget.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function target() {
  const f = await budgetFixture();
  fixtures.push(f);
  const accounts = createAccounts(createAccountStore(f.path), f.runtime);
  const card = accounts.previewAdd({
    name: "Synthetic card",
    kind: "credit",
    currency: "USD",
    openingCents: -5000,
    openingDate: "2026-09-30",
  });
  if (!card.ok) throw new Error(card.reason);
  const saved = accounts.commit(card.value);
  if (!saved.ok) throw new Error(saved.reason);
  const cardId = saved.value.account.id;
  const facts = {
    ...f.facts,
    opening: {
      ...f.facts.opening,
      accounts: [
        ...f.facts.opening.accounts,
        {
          accountId: cardId,
          kind: "credit" as const,
          balanceCents: -5000,
          closed: false,
          evidence: "Synthetic statement",
        },
      ],
      categories: [
        { categoryId: "food", availableCents: 0, evidence: "Zero" },
        { categoryId: "reserve", availableCents: 7000, evidence: "Reviewed reserve" },
      ],
      readyToAssignCents: 93000,
    },
    categories: [
      ...f.facts.categories,
      { id: "reserve", groupId: "cards", name: "Card", archived: false, cardAccountId: cardId },
    ],
    assignments: [
      ...f.facts.assignments,
      { month: "2026-10", categoryId: "reserve", amountCents: 0 },
      { month: "2026-11", categoryId: "reserve", amountCents: 0 },
    ],
  };
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const p = app.preview(
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
  );
  if (!p.ok) throw new Error(p.reason);
  expect(app.commit(p.value).ok).toBe(true);
  return { ...f, app, cardId };
}
it("writes both transfer legs and card overpayment once, rejects unilateral edits, and supports correction", async () => {
  const f = await target();
  const p = f.app.preview(
    {
      kind: "transfer",
      fromAccountId: f.accountId,
      toAccountId: f.cardId,
      date: "2026-10-02",
      amountCents: 7000,
      categoryId: null,
      expectedFromVersion: 1,
      expectedToVersion: 1,
      fromTransactionId: null,
      toTransactionId: null,
    },
    1,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(f.app.commit(p.value).ok).toBe(true);
  expect(f.app.report("2026-10")).toMatchObject({
    ok: true,
    value: {
      month: {
        heldFundsCents: 95000,
        readyToAssignCents: 95000,
        cards: [{ balanceCents: 2000, reserveCents: 0 }],
      },
    },
  });
  const tx = createTransactions(createTransactionStore(f.path), f.runtime);
  const id = p.value.transferLegIds!.from;
  expect(
    tx.previewEdit(id, 1, { occurredOn: "2026-10-02", cents: -6000, payee: "Transfer", memo: "" }),
  ).toMatchObject({ ok: false, reason: "linked-transfer" });
  const edit = f.app.preview(
    {
      kind: "transfer-edit",
      id: p.value.operationId,
      date: "2026-10-03",
      amountCents: 6000,
      categoryId: null,
      expectedActivityVersion: 2,
    },
    2,
  );
  if (!edit.ok) throw new Error(edit.reason);
  expect(f.app.commit(edit.value).ok).toBe(true);
  expect(
    f.app
      .inspect()
      .transactions.map((t) => t.cents)
      .sort((a, b) => a - b),
  ).toEqual([-6000, 6000]);
});
it("keeps transfer legs and audit unchanged after injected failure", async () => {
  const f = await target();
  const app = createBudget(
    createBudgetStore(f.path, () => {
      throw new Error("Synthetic transfer failure");
    }),
    f.runtime,
  );
  const before = app.inspect();
  const p = app.preview(
    {
      kind: "transfer",
      fromAccountId: f.accountId,
      toAccountId: f.cardId,
      date: "2026-10-02",
      amountCents: 5000,
      categoryId: null,
      expectedFromVersion: 1,
      expectedToVersion: 1,
      fromTransactionId: null,
      toTransactionId: null,
    },
    1,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(() => app.commit(p.value)).toThrow("Operation ID");
  expect(app.inspect()).toEqual(before);
});
it("retains successful operation receipts after later budget changes", async () => {
  const f = await target();
  const original = f.app.preview(
    { kind: "assign", month: "2026-10", categoryId: "food", amountCents: 1000 },
    1,
  );
  if (!original.ok) throw new Error(original.reason);
  expect(f.app.commit(original.value).ok).toBe(true);
  const next = f.app.preview(
    { kind: "assign", month: "2026-10", categoryId: "food", amountCents: 2000 },
    2,
  );
  if (!next.ok) throw new Error(next.reason);
  expect(f.app.commit(next.value).ok).toBe(true);
  expect(f.app.commit(original.value)).toMatchObject({
    ok: true,
    value: { reused: true, revision: 2 },
  });
  expect(f.app.inspect().state?.revision).toBe(3);
});
