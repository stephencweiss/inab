import type { BudgetFacts } from "../budget/types.js";
import { validateOpening } from "../budget/opening.js";
import { formatCents } from "./render.js";

export function budgetReviewSummary(facts: BudgetFacts, throughDate: string) {
  const lines = [
    `Budget starts ${facts.startMonth}; activity reviewed through ${throughDate}.`,
    "Opening categories:",
  ];
  for (const category of facts.categories) {
    const opening = facts.opening.categories.find((value) => value.categoryId === category.id);
    lines.push(
      `  ${category.name} (group: ${category.groupId}): ${formatCents(opening?.availableCents ?? 0)} USD Available${category.cardAccountId === null ? "" : "; card payment reserve"}`,
    );
    for (const assignment of facts.assignments.filter((value) => value.categoryId === category.id))
      lines.push(`    Assigned ${assignment.month}: ${formatCents(assignment.amountCents)} USD`);
  }
  lines.push(`Opening Ready to Assign: ${formatCents(facts.opening.readyToAssignCents)} USD`);
  const check = validateOpening(facts);
  if (check.ok)
    lines.push(
      `Opening check: held funds ${formatCents(check.heldFundsCents)} USD; category funds plus Ready to Assign ${formatCents(check.allocatedCents)} USD; difference ${formatCents(check.differenceCents)} USD.`,
    );
  else
    lines.push(
      `Opening needs review: ${check.reason}. Use Edit to correct the JSON before activation.`,
    );
  lines.push(
    `${facts.events.length} reviewed activity events. Activation still requires a separate preview and explicit commit.`,
    "Edit opens JSON in Vim. JSON money uses integer cents: 10000 means 100.00 USD. Change a category name to fix a typo; keep its ID to preserve links.",
  );
  return lines.join("\n");
}
