import { calculateBudget } from "../budget/calculate.js";
import { validateOpening } from "../budget/opening.js";
import type { BudgetFacts, BudgetEvent } from "../budget/types.js";
import type { BudgetPreview } from "../application/budget-ports.js";

function namedCategory<T extends { categoryId: string }>(value: T, names: Map<string, string>) {
  return { ...value, categoryName: names.get(value.categoryId) ?? null };
}
function eventForDisplay(event: BudgetEvent, names: Map<string, string>) {
  if (event.kind === "transfer")
    return {
      ...event,
      categoryName: event.categoryId === null ? null : (names.get(event.categoryId) ?? null),
    };
  if (event.allocation.kind !== "categories") return event;
  return {
    ...event,
    allocation: {
      ...event.allocation,
      lines: event.allocation.lines.map((line) => namedCategory(line, names)),
    },
  };
}
/** These labels are for output only. Keep the original facts for saved reviews and writes. */
export function budgetFactsForDisplay(facts: BudgetFacts) {
  const names = new Map(facts.categories.map((category) => [category.id, category.name]));
  return {
    ...facts,
    opening: {
      ...facts.opening,
      categories: facts.opening.categories.map((category) => namedCategory(category, names)),
    },
    assignments: facts.assignments.map((assignment) => namedCategory(assignment, names)),
    events: facts.events.map((event) => eventForDisplay(event, names)),
  };
}
/** The display copy must not replace the application preview used for confirmation. */
export function budgetPreviewForDisplay(preview: BudgetPreview) {
  return {
    ...preview,
    command:
      "facts" in preview.command
        ? { ...preview.command, facts: budgetFactsForDisplay(preview.command.facts) }
        : preview.command,
    after: budgetFactsForDisplay(preview.after),
  };
}
function calculationForDisplay(facts: BudgetFacts, horizon: string) {
  const calculated = calculateBudget(facts, horizon);
  if (!calculated.ok) return calculated;
  const names = new Map(facts.categories.map((category) => [category.id, category.name]));
  return {
    ...calculated,
    months: calculated.months.map((month) => ({
      ...month,
      categories: month.categories.map((category) => namedCategory(category, names)),
    })),
  };
}
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
    calculated = calculationForDisplay(after, horizon);
  return {
    opening: validateOpening(after),
    accountBridgesVerified: true,
    affectedMonths: calculated.ok ? calculated.months.map((m) => m.month) : [],
    before: before === null ? null : calculationForDisplay(before, horizon),
    after: calculated,
  };
}
