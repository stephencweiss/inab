import { parseMonth } from "./parse.js";
import type { BudgetResult } from "./types.js";
export function budgetMonths(start: string, end: string): BudgetResult<string[]> {
  if (!parseMonth(start).ok || !parseMonth(end).ok || end < start)
    return { ok: false, reason: "invalid-report-horizon" };
  if (monthIndex(end) - monthIndex(start) + 1 > 1200)
    return { ok: false, reason: "report-horizon-too-long" };
  const months: string[] = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    if (current === end) break;
    const year = Number(current.slice(0, 4));
    const month = Number(current.slice(5));
    current =
      month === 12
        ? `${String(year + 1).padStart(4, "0")}-01`
        : `${current.slice(0, 4)}-${String(month + 1).padStart(2, "0")}`;
  }
  return { ok: true, value: months };
}

function monthIndex(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
}
