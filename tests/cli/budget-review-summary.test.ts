import { expect, it } from "vitest";
import { budgetReviewSummary } from "../../src/cli/budget-review-summary.js";

it("shows names, groups, money, and the checked opening equation", () => {
  const summary = budgetReviewSummary(
    {
      startMonth: "2026-11",
      currency: "USD",
      opening: {
        accounts: [
          {
            accountId: "cash",
            kind: "cash",
            balanceCents: -1000,
            closed: false,
            evidence: "statement",
          },
        ],
        categories: [{ categoryId: "housing", availableCents: 0, evidence: "prior plan" }],
        readyToAssignCents: -1000,
        evidence: "checked",
        deficitAcknowledged: true,
      },
      categories: [
        { id: "housing", name: "Housing", groupId: "Fixed", cardAccountId: null, archived: false },
      ],
      assignments: [{ month: "2026-11", categoryId: "housing", amountCents: 12500 }],
      events: [],
    },
    "2026-11-06",
  );
  expect(summary).toContain("Housing (group: Fixed)");
  expect(summary).toContain("Assigned 2026-11: 125.00 USD");
  expect(summary).toContain("held funds -10.00 USD");
  expect(summary).toContain("difference 0.00 USD");
  expect(summary).toContain("through 2026-11-06");
});
