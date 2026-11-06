import { calculateBudget } from "../budget/calculate.js";
import { validateOpening } from "../budget/opening.js";
import type { BudgetFacts } from "../budget/types.js";
/** Call only after the application validates the complete preview and account bridges. */
export function budgetPreviewSummary(
  before: BudgetFacts | null,
  after: BudgetFacts,
  today: string,
) {
  const horizon = after.assignments.reduce(
      (end, a) => (a.month > end ? a.month : end),
      today.slice(0, 7),
    ),
    calculated = calculateBudget(after, horizon);
  return {
    opening: validateOpening(after),
    accountBridgesVerified: true,
    affectedMonths: calculated.ok ? calculated.months.map((m) => m.month) : [],
    before: before === null ? null : calculateBudget(before, horizon),
    after: calculated,
  };
}
