import { expect, it } from "vitest";
import { renderBudgetReport } from "../../src/cli/budget-render.js";
it("shows exact USD cents, category totals and card reserve warnings", () => {
  const text = renderBudgetReport({
    revision: 3,
    status: "active",
    startMonth: "2026-10",
    categories: [
      { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
    ],
    month: {
      month: "2026-11",
      readyToAssignCents: 1234,
      futureAssignedCents: 200,
      fundingDeficitCents: 0,
      heldFundsCents: 2000,
      complete: false,
      unallocatedEventIds: ["tx"],
      categories: [
        {
          categoryId: "food",
          carryInCents: 100,
          assignedCents: 200,
          activityCents: -301,
          availableCents: -1,
          cashOverspentCents: 1,
          creditOverspentCents: 0,
        },
      ],
      cards: [{ accountId: "card", balanceCents: -1000, reserveCents: 900, shortfallCents: 100 }],
    },
  });
  expect(text).toContain("Ready to Assign: USD 12.34");
  expect(text).toContain("Food");
  expect(text).toContain("-0.01");
  expect(text).toContain("shortfall 1.00");
  expect(text).toContain("Unallocated: tx");
  expect(text).toContain("Carry-in | Assigned | Activity | Available");
});
