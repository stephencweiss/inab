import { expect, it } from "vitest";
import { budgetPreviewSummary, budgetPreviewForDisplay } from "../../src/cli/budget-preview.js";
import type { BudgetFacts } from "../../src/budget/types.js";
import type { BudgetPreview } from "../../src/application/budget-ports.js";
const labeledFacts: BudgetFacts = {
  startMonth: "2026-11",
  currency: "USD",
  opening: {
    accounts: [
      {
        accountId: "cash",
        kind: "cash",
        closed: false,
        balanceCents: 100000,
        evidence: "statement",
      },
    ],
    categories: [{ categoryId: "category-17", availableCents: 0, evidence: "zero" }],
    readyToAssignCents: 100000,
    evidence: "checked totals",
    deficitAcknowledged: false,
  },
  categories: [
    { id: "category-17", name: "Food", groupId: "Living", archived: false, cardAccountId: null },
  ],
  assignments: [{ month: "2026-11", categoryId: "category-17", amountCents: 20000 }],
  events: [
    {
      kind: "transaction",
      id: "purchase",
      sourceId: "manual-purchase",
      date: "2026-11-02",
      order: 0,
      accountId: "cash",
      amountCents: -5000,
      allocation: {
        kind: "categories",
        lines: [{ categoryId: "category-17", amountCents: -5000 }],
      },
    },
    {
      kind: "transfer",
      id: "outflow",
      sourceId: "manual-outflow",
      date: "2026-11-03",
      order: 1,
      fromAccountId: "cash",
      toAccountId: "tracking",
      amountCents: 1000,
      categoryId: "category-17",
    },
  ],
};
it("shows the category name for each before/after total, including a rename", () => {
  const after = {
    ...labeledFacts,
    categories: labeledFacts.categories.map((category) => ({ ...category, name: "Groceries" })),
  };
  const summary = budgetPreviewSummary(labeledFacts, after, "2026-11-05");
  expect(summary.before).toMatchObject({
    ok: true,
    months: [{ categories: [{ categoryId: "category-17", categoryName: "Food" }] }],
  });
  expect(summary.after).toMatchObject({
    ok: true,
    months: [
      {
        categories: [
          { categoryId: "category-17", categoryName: "Groceries", availableCents: 14000 },
        ],
      },
    ],
  });
});
it("labels category references in the displayed preview without changing its saved facts", () => {
  const coverage = {
    throughDate: "2026-11-05",
    evidence: "complete",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  };
  const preview: BudgetPreview = {
    command: { kind: "activate", facts: labeledFacts, coverage },
    after: labeledFacts,
    coverage,
    baseline: "{}",
    expectedRevision: 0,
    operationId: "preview",
    recordedAt: "2026-11-05T00:00:00.000Z",
    transferLegIds: null,
  };
  const original = structuredClone(preview);
  const shown = budgetPreviewForDisplay(preview);
  const category = { categoryId: "category-17", categoryName: "Food" };
  expect(shown.after.opening.categories[0]).toMatchObject(category);
  expect(shown.after.assignments[0]).toMatchObject(category);
  expect(shown.after.events[0]).toMatchObject({ allocation: { lines: [category] } });
  expect(shown.after.events[1]).toMatchObject(category);
  expect(shown.command).toMatchObject({
    facts: { opening: { categories: [category] }, assignments: [category] },
  });
  expect(preview).toEqual(original);
  expect(JSON.stringify(preview)).not.toContain("categoryName");
});
it("shows the opening equation and affected month totals before confirmation", () => {
  const facts: BudgetFacts = {
    startMonth: "2026-10",
    currency: "USD",
    opening: {
      accounts: [],
      categories: [],
      readyToAssignCents: 0,
      evidence: "reviewed",
      deficitAcknowledged: false,
    },
    categories: [],
    assignments: [],
    events: [],
  };
  const summary = budgetPreviewSummary(null, facts, "2026-11-05");
  expect(summary.opening).toMatchObject({ ok: true, differenceCents: 0 });
  expect(summary.after.ok).toBe(true);
  expect(summary.affectedMonths).toEqual(["2026-10", "2026-11"]);
  expect(summary.before).toBeNull();
});
