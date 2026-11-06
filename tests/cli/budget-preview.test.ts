import { expect, it } from "vitest";
import { budgetPreviewSummary } from "../../src/cli/budget-preview.js";
import type { BudgetFacts } from "../../src/budget/types.js";
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
