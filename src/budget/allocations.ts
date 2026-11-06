import { checkedSum } from "../lib/money.js";
import type { AllocationLine, BudgetFailure } from "./types.js";
export function validateAllocations(
  amountCents: number,
  lines: readonly AllocationLine[],
): { ok: true } | BudgetFailure {
  const sum = checkedSum(lines.map((l) => l.amountCents));
  if (!sum.ok) return sum;
  if (
    !Number.isSafeInteger(amountCents) ||
    lines.length === 0 ||
    new Set(lines.map((line) => line.categoryId)).size !== lines.length ||
    sum.value !== amountCents
  )
    return { ok: false, reason: "allocation-sum-mismatch" };
  return { ok: true };
}
