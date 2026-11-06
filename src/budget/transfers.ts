import type { BudgetFacts, BudgetFailure, BudgetTransfer } from "./types.js";
export function validateTransfer(
  transfer: BudgetTransfer,
  facts: BudgetFacts,
): { ok: true } | BudgetFailure {
  if (!isTransferAmount(transfer)) return { ok: false, reason: "invalid-transfer" };
  const from = facts.opening.accounts.find((a) => a.accountId === transfer.fromAccountId);
  const to = facts.opening.accounts.find((a) => a.accountId === transfer.toAccountId);
  if (from?.kind === "cash" && (to?.kind === "cash" || to?.kind === "credit"))
    return transfer.categoryId === null
      ? { ok: true }
      : { ok: false, reason: "transfer-category-forbidden" };
  if (
    from?.kind === "cash" &&
    !to &&
    transfer.categoryId !== null &&
    isSpendingCategory(transfer.categoryId, facts)
  )
    return { ok: true };
  if (
    !from &&
    to?.kind === "cash" &&
    (transfer.categoryId === null || isSpendingCategory(transfer.categoryId, facts))
  )
    return { ok: true };
  return { ok: false, reason: "unsupported-transfer-treatment" };
}

function isSpendingCategory(categoryId: string | null, facts: BudgetFacts) {
  return facts.categories.some((c) => c.id === categoryId && c.cardAccountId === null);
}

function isTransferAmount(transfer: BudgetTransfer) {
  return (
    transfer.fromAccountId !== transfer.toAccountId &&
    Number.isSafeInteger(transfer.amountCents) &&
    transfer.amountCents > 0
  );
}
