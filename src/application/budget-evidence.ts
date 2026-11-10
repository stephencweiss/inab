import type { BudgetFacts, BudgetEvent, BudgetTransfer } from "../budget/types.js";
import type { BudgetSnapshot, BudgetSourceRow } from "./budget-ports.js";
export function budgetSourceRows(snapshot: BudgetSnapshot) {
  const byId = new Map(snapshot.sourceRows.map((r) => [r.id, r]));
  const byTransaction = new Map(
    snapshot.sourceRows.filter((r) => r.transactionId !== null).map((r) => [r.transactionId, r.id]),
  );
  return (event: BudgetEvent): string[] => {
    if (event.kind === "transaction")
      return [
        ...new Set(
          [
            byId.has(event.sourceId) ? event.sourceId : null,
            byTransaction.get(event.id) ?? null,
          ].filter((v) => v !== null),
        ),
      ];
    const parts = event.sourceId.split("|");
    if (parts[0] === "history") return parts.slice(1).filter((id) => byId.has(id));
    if (parts[0] === "transfer")
      return parts
        .slice(1)
        .flatMap((id) => (byTransaction.has(id) ? [byTransaction.get(id)!] : []));
    return [];
  };
}
function liveTransferEvidence(
  snapshot: BudgetSnapshot,
  event: BudgetTransfer,
  ids: string[],
): string | null {
  const from = snapshot.accounts.find((a) => a.id === event.fromAccountId),
    to = snapshot.accounts.find((a) => a.id === event.toAccountId);
  if (!from || !to) return "account-unavailable";
  const left = snapshot.transactions.find((t) => t.id === ids[1]),
    right = snapshot.transactions.find((t) => t.id === ids[2]);
  if (
    from.kind !== "tracking" &&
    (!left ||
      left.accountId !== from.id ||
      left.cents !== -event.amountCents ||
      left.occurredOn !== event.date)
  )
    return "transfer-evidence-mismatch";
  if (
    to.kind !== "tracking" &&
    (!right ||
      right.accountId !== to.id ||
      right.cents !== event.amountCents ||
      right.occurredOn !== event.date)
  )
    return "transfer-evidence-mismatch";
  return null;
}
function historicalLeg(
  snapshot: BudgetSnapshot,
  row: BudgetSourceRow | null,
  accountId: string,
  cents: number,
  date: string,
  reference: string,
  corrected: boolean,
): boolean {
  if (!row)
    return (
      snapshot.accounts.some((a) => a.id === accountId && a.kind === "tracking") &&
      reference === `external:${accountId}`
    );
  return (
    corrected ||
    (row.accountId === accountId &&
      row.cents === cents &&
      row.date === date &&
      row.transactionId === null)
  );
}
function transferEvidence(
  snapshot: BudgetSnapshot,
  event: BudgetTransfer,
  rows: Map<string, BudgetSourceRow>,
): string | null {
  if (
    !snapshot.accounts.some((a) => a.id === event.fromAccountId) ||
    !snapshot.accounts.some((a) => a.id === event.toAccountId)
  )
    return "account-unavailable";
  const ids = event.sourceId.split("|");
  if (ids.length === 1) return null;
  if (ids.length !== 3 || !ids[1] || !ids[2]) return "transfer-evidence-mismatch";
  if (ids[0] === "transfer") return liveTransferEvidence(snapshot, event, ids);
  if (ids[0] !== "history") return "transfer-evidence-mismatch";
  const corrected =
    snapshot.state?.facts.events.some((e) => e.id === event.id && e.sourceId === event.sourceId) ??
    false;
  return historicalLeg(
    snapshot,
    rows.get(ids[1]) ?? null,
    event.fromAccountId,
    -event.amountCents,
    event.date,
    ids[1],
    corrected,
  ) &&
    historicalLeg(
      snapshot,
      rows.get(ids[2]) ?? null,
      event.toAccountId,
      event.amountCents,
      event.date,
      ids[2],
      corrected,
    )
    ? null
    : "transfer-evidence-mismatch";
}
export function budgetRelationships(snapshot: BudgetSnapshot, facts: BudgetFacts): string | null {
  const used = new Set<string>(),
    consume = budgetSourceRows(snapshot),
    rows = new Map(snapshot.sourceRows.map((r) => [r.id, r]));
  for (const event of facts.events) {
    if (event.kind === "transfer") {
      const failure = transferEvidence(snapshot, event, rows);
      if (failure) return failure;
    } else if (!snapshot.accounts.some((a) => a.id === event.accountId && a.kind !== "tracking"))
      return "account-unavailable";
    for (const id of consume(event)) {
      if (used.has(id)) return "duplicate-source-effect";
      used.add(id);
    }
  }
  return null;
}
