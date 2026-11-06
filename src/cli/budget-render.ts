import { formatCents } from "./render.js";
import type { budgetApplication } from "../bootstrap.js";
type BudgetReport = Extract<
  ReturnType<ReturnType<typeof budgetApplication>["report"]>,
  { ok: true }
>["value"];
export function renderBudgetReport(report: BudgetReport) {
  const { month } = report;
  const lines = [
    `Budget ${month.month} | ${report.status} | revision ${report.revision}`,
    `Ready to Assign: USD ${formatCents(month.readyToAssignCents)}`,
    `Held funds: USD ${formatCents(month.heldFundsCents)} | future assigned: USD ${formatCents(month.futureAssignedCents)} | funding deficit: USD ${formatCents(month.fundingDeficitCents)}`,
    "Category | Carry-in | Assigned | Activity | Available | Cash overspent | Credit overspent",
  ];
  for (const c of month.categories) {
    const name =
      report.categories.find((category) => category.id === c.categoryId)?.name ?? c.categoryId;
    lines.push(
      `${name} (${c.categoryId}) | ${[c.carryInCents, c.assignedCents, c.activityCents, c.availableCents, c.cashOverspentCents, c.creditOverspentCents].map(formatCents).join(" | ")}`,
    );
  }
  for (const card of month.cards)
    lines.push(
      `Card ${card.accountId} | balance ${formatCents(card.balanceCents)} | payment reserve ${formatCents(card.reserveCents)} | shortfall ${formatCents(card.shortfallCents)}`,
    );
  lines.push(
    month.complete
      ? "Activity allocation complete"
      : `Unallocated: ${month.unallocatedEventIds.join(", ")}`,
  );
  return lines.join("\n");
}
