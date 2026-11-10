import { checkedSum } from "../lib/money.js";
import { parseBudgetFacts } from "./parse.js";
import type { BudgetFacts } from "./types.js";
/** Opening ordinary categories must already include prior-month rollover; negative card reserves remain valid. */
export function validateOpening(facts: BudgetFacts) {
  const parsed = parseBudgetFacts(facts);
  if (!parsed.ok) return parsed;
  if (
    facts.opening.accounts.some(
      (a) => a.kind === "credit" && !facts.categories.some((c) => c.cardAccountId === a.accountId),
    )
  )
    return { ok: false as const, reason: "missing-card-category" };
  const ordinaryCategories = new Set(
    facts.categories.filter((c) => c.cardAccountId === null).map((c) => c.id),
  );
  if (
    facts.opening.categories.some(
      (c) => ordinaryCategories.has(c.categoryId) && c.availableCents < 0,
    )
  )
    return { ok: false as const, reason: "opening-overspending-needs-resolution" };
  const held = checkedSum(
    facts.opening.accounts.map((a) =>
      a.kind === "cash" ? a.balanceCents : Math.max(a.balanceCents, 0),
    ),
  );
  const allocated = checkedSum([
    facts.opening.readyToAssignCents,
    ...facts.opening.categories.map((c) => c.availableCents),
  ]);
  if (!held.ok) return held;
  if (!allocated.ok) return allocated;
  const difference = checkedSum([held.value, -allocated.value]);
  if (!difference.ok) return difference;
  if (difference.value !== 0)
    return { ok: false as const, reason: "opening-difference", differenceCents: difference.value };
  if (
    (facts.opening.readyToAssignCents < 0 ||
      facts.opening.accounts.some((a) => a.kind === "cash" && a.balanceCents < 0)) &&
    !facts.opening.deficitAcknowledged
  )
    return { ok: false as const, reason: "unacknowledged-opening-deficit" };
  return {
    ok: true as const,
    heldFundsCents: held.value,
    allocatedCents: allocated.value,
    differenceCents: 0,
  };
}
