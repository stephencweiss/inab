import { expect, it } from "vitest";
import { budgetMonths } from "../../src/budget/months.ts";
import { parseBudgetFacts } from "../../src/budget/parse.ts";
import { validateAllocations } from "../../src/budget/allocations.ts";
import { fixture } from "./budget-opening.test.ts";
it("accepts a mixed-sign split with an exact signed sum", () =>
  expect(
    validateAllocations(-100, [
      { categoryId: "a", amountCents: -200 },
      { categoryId: "b", amountCents: 100 },
    ]).ok,
  ).toBe(true));
it("rejects duplicate source effects and category assignments", () => {
  const f = fixture();
  f.assignments = [
    { month: "2026-10", categoryId: "food", amountCents: 0 },
    { month: "2026-10", categoryId: "food", amountCents: 0 },
  ];
  expect(parseBudgetFacts(f).ok).toBe(false);
});
it("crosses December without changing its inclusive horizon", () =>
  expect(budgetMonths("2026-12", "2027-01")).toEqual({ ok: true, value: ["2026-12", "2027-01"] }));
it("rejects repeated category lines", () =>
  expect(
    validateAllocations(-100, [
      { categoryId: "a", amountCents: -50 },
      { categoryId: "a", amountCents: -50 },
    ]).ok,
  ).toBe(false));
it("bounds a report to 1200 inclusive months", () => {
  expect(budgetMonths("1900-01", "1999-12").ok).toBe(true);
  expect(budgetMonths("1900-01", "2000-01")).toEqual({
    ok: false,
    reason: "report-horizon-too-long",
  });
  expect(budgetMonths("9999-12", "9999-12")).toEqual({ ok: true, value: ["9999-12"] });
});
