import { expect, it } from "vitest";
import { applyBudgetCommand } from "../../src/application/budget-operations.js";
import { calculateBudget } from "../../src/budget/calculate.js";
import type { BudgetSnapshot } from "../../src/application/budget-ports.js";

const coverage = {
  throughDate: "2026-12-01",
  evidence: "Reviewed November purchase and December income",
  includedTransactionIds: ["purchase", "income"],
  postedBridgeEventIds: [],
};
const snapshot: BudgetSnapshot = {
  targetId: "synthetic",
  setupState: "fresh",
  accounts: [],
  transactions: [],
  sourceRows: [],
  state: {
    revision: 1,
    status: "active",
    coverage,
    receipt: { operationId: "activation", revision: 1, reviewId: "review" },
    facts: {
      startMonth: "2026-11",
      currency: "USD",
      opening: {
        accounts: [
          { accountId: "cash", kind: "cash", balanceCents: 0, closed: false, evidence: "zero" },
          { accountId: "card", kind: "credit", balanceCents: 0, closed: false, evidence: "zero" },
        ],
        categories: [
          { categoryId: "food", availableCents: 0, evidence: "zero" },
          { categoryId: "payment", availableCents: 0, evidence: "zero" },
        ],
        readyToAssignCents: 0,
        evidence: "zero",
        deficitAcknowledged: false,
      },
      categories: [
        { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
        {
          id: "payment",
          groupId: "cards",
          name: "Card payment",
          archived: false,
          cardAccountId: "card",
        },
      ],
      assignments: [
        { month: "2026-11", categoryId: "food", amountCents: 0 },
        { month: "2026-11", categoryId: "payment", amountCents: 0 },
        { month: "2026-12", categoryId: "food", amountCents: 0 },
        { month: "2026-12", categoryId: "payment", amountCents: 0 },
      ],
      events: [
        {
          kind: "transaction",
          id: "purchase",
          sourceId: "live:purchase",
          date: "2026-11-02",
          order: 0,
          accountId: "card",
          amountCents: -1000,
          allocation: { kind: "categories", lines: [{ categoryId: "food", amountCents: -1000 }] },
        },
        {
          kind: "transaction",
          id: "income",
          sourceId: "live:income",
          date: "2026-12-01",
          order: 1,
          accountId: "cash",
          amountCents: 1000,
          allocation: { kind: "income" },
        },
      ],
    },
  },
};
function assign(month: string, amountCents: number) {
  return applyBudgetCommand(
    snapshot,
    { kind: "assign", month, categoryId: "payment", amountCents },
    "2026-12-01",
    "assign",
    null,
  );
}
it("uses December income to cover November card debt in December", () => {
  const result = assign("2026-12", 1000);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  const calculation = calculateBudget(result.value.facts, "2026-12");
  expect(calculation).toMatchObject({
    ok: true,
    months: [
      {
        month: "2026-11",
        readyToAssignCents: 0,
        cards: [{ balanceCents: -1000, reserveCents: 0, shortfallCents: 1000 }],
      },
      {
        month: "2026-12",
        readyToAssignCents: 0,
        fundingDeficitCents: 0,
        cards: [{ balanceCents: -1000, reserveCents: 1000, shortfallCents: 0 }],
      },
    ],
  });
});
it("can reserve current cash for a future month after later income arrived", () => {
  expect(assign("2027-01", 1000).ok).toBe(true);
});
it("does not use December income to fund a November assignment", () => {
  expect(assign("2026-11", 1000)).toMatchObject({ ok: false, reason: "insufficient-funds" });
});
it.each(["2026-12", "2027-01"])("refuses more than current cash for %s", (month) => {
  expect(assign(month, 2000)).toMatchObject({ ok: false, reason: "insufficient-funds" });
});
