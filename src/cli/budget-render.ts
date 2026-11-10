import { formatCents } from "./render.js";
import type { budgetApplication } from "../bootstrap.js";
type BudgetReport = Extract<
  ReturnType<ReturnType<typeof budgetApplication>["report"]>,
  { ok: true }
>["value"];
function tableLines(headers: string[], rows: string[][], textColumns: number) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (row: string[]) =>
    row
      .map((value, index) =>
        index < textColumns
          ? value.padEnd(widths[index] ?? value.length)
          : value.padStart(widths[index] ?? value.length),
      )
      .join(" | ");
  return [line(headers), widths.map((width) => "-".repeat(width)).join("-+-"), ...rows.map(line)];
}
export function renderBudgetReport(report: BudgetReport) {
  const { month } = report;
  const lines = [
    `Budget ${month.month} | ${report.status} | revision ${report.revision}`,
    `Ready to Assign: USD ${formatCents(month.readyToAssignCents)}`,
    `Held funds: USD ${formatCents(month.heldFundsCents)} | future assigned: USD ${formatCents(month.futureAssignedCents)} | funding deficit: USD ${formatCents(month.fundingDeficitCents)}`,
    "",
  ];
  const rows: string[][] = [];
  for (const c of month.categories) {
    const name =
      report.categories.find((category) => category.id === c.categoryId)?.name ??
      "Unknown category";
    rows.push([
      name,
      c.categoryId,
      ...[
        c.carryInCents,
        c.assignedCents,
        c.activityCents,
        c.availableCents,
        c.cashOverspentCents,
        c.creditOverspentCents,
      ].map(formatCents),
    ]);
  }
  lines.push(
    ...tableLines(
      [
        "Category",
        "ID",
        "Carry-in",
        "Assigned",
        "Activity",
        "Available",
        "Cash overspent",
        "Credit overspent",
      ],
      rows,
      2,
    ),
  );
  if (month.cards.length > 0) {
    lines.push(
      "",
      ...tableLines(
        ["Card ID", "Balance", "Payment reserve", "Shortfall"],
        month.cards.map((card) => [
          card.accountId,
          ...[card.balanceCents, card.reserveCents, card.shortfallCents].map(formatCents),
        ]),
        1,
      ),
    );
  }
  lines.push("");
  lines.push(
    month.complete
      ? "Activity allocation complete"
      : `Unallocated: ${month.unallocatedEventIds.join(", ")}`,
  );
  return lines.join("\n");
}
