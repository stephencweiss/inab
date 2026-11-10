import { checkedSum } from "../lib/money.js";
import { parseDate } from "../lib/date.js";
import { budgetMonths } from "../budget/months.js";
import { budgetRelationships, budgetSourceRows } from "./budget-evidence.js";
import type { BudgetFacts, BudgetEvent } from "../budget/types.js";
import type { BudgetSnapshot, BudgetCoverage, BudgetResult } from "./budget-ports.js";

function eventEffect(event: BudgetEvent, accountId: string) {
  if (event.kind === "transaction") return event.accountId === accountId ? event.amountCents : 0;
  if (event.fromAccountId === accountId) return -event.amountCents;
  return event.toAccountId === accountId ? event.amountCents : 0;
}
export function currentAccountBalances(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
): string | null {
  for (const account of snapshot.accounts.filter((a) => a.kind !== "tracking")) {
    const opening = facts.opening.accounts.find((a) => a.accountId === account.id);
    if (!opening || account.openingCents === null) return "missing-opening-account";
    const recorded = checkedSum([
      account.openingCents,
      ...snapshot.transactions.filter((t) => t.accountId === account.id).map((t) => t.cents),
    ]);
    const budget = checkedSum([
      opening.balanceCents,
      ...facts.events.map((e) => eventEffect(e, account.id)),
    ]);
    if (!recorded.ok) return recorded.reason;
    if (!budget.ok) return budget.reason;
    if (recorded.value !== budget.value) return "current-account-balance-mismatch";
  }
  return null;
}
export function accountBoundary(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  coverage: BudgetCoverage,
): string | null {
  const first = `${facts.startMonth}-01`;
  for (const account of snapshot.accounts.filter((a) => a.kind !== "tracking")) {
    const opening = facts.opening.accounts.find((a) => a.accountId === account.id);
    if (!opening || opening.kind !== account.kind) return "missing-opening-account";
    if (account.openingDate === null || account.openingCents === null)
      return "missing-opening-account";
    const bridge =
      account.openingDate < first
        ? checkedSum([
            account.openingCents,
            ...snapshot.transactions
              .filter(
                (t) => t.accountId === account.id && t.postedOn !== null && t.postedOn < first,
              )
              .map((t) => t.cents),
            ...snapshot.transactions
              .filter(
                (t) =>
                  t.accountId === account.id &&
                  coverage.includedTransactionIds.includes(t.id) &&
                  (t.postedOn === null || t.postedOn >= first),
              )
              .map((t) => t.cents),
          ])
        : checkedSum([
            opening.balanceCents,
            ...facts.events
              .filter(
                (e) =>
                  coverage.postedBridgeEventIds.includes(e.id) && e.date <= account.openingDate,
              )
              .map((e) => eventEffect(e, account.id)),
          ]);
    if (!bridge.ok) return bridge.reason;
    if (
      bridge.value !== (account.openingDate < first ? opening.balanceCents : account.openingCents)
    )
      return "opening-account-mismatch";
  }
  if (
    facts.opening.accounts.some(
      (a) => !snapshot.accounts.some((s) => s.id === a.accountId && s.kind === a.kind),
    )
  )
    return "unknown-opening-account";
  return null;
}
function transactionCoverage(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  coverage: BudgetCoverage,
): string | null {
  const first = `${facts.startMonth}-01`;
  for (const t of snapshot.transactions) {
    const event = facts.events.find((e) => e.kind === "transaction" && e.id === t.id);
    const included = coverage.includedTransactionIds.includes(t.id);
    if (included && t.occurredOn >= first) return "invalid-opening-membership";
    if (event) {
      const reason = liveEvidence(event, t, first);
      if (reason) return reason;
      if (included) return "duplicate-budget-effect";
    } else if (
      !included &&
      needsReview(t, first) &&
      !facts.events.some((e) => e.kind === "transfer" && e.sourceId.split("|").includes(t.id))
    )
      return "missing-transaction-review";
  }
  return null;
}
function liveEvidence(
  event: BudgetEvent,
  t: BudgetSnapshot["transactions"][number],
  first: string,
): string | null {
  if (
    event.kind !== "transaction" ||
    event.accountId !== t.accountId ||
    event.amountCents !== t.cents
  )
    return "transaction-evidence-mismatch";
  return t.occurredOn >= first && event.date !== t.occurredOn ? "transaction-date-mismatch" : null;
}
function needsReview(t: BudgetSnapshot["transactions"][number], first: string) {
  return t.occurredOn >= first || t.postedOn === null || t.postedOn >= first;
}
function sourceCoverage(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  coverage: BudgetCoverage,
): string | null {
  const first = `${facts.startMonth}-01`,
    used = new Set(facts.events.flatMap(budgetSourceRows(snapshot)));
  for (const row of snapshot.sourceRows) {
    if (
      row.date < first ||
      row.date > coverage.throughDate ||
      row.cents === 0 ||
      row.role === "opening"
    )
      continue;
    if (snapshot.accounts.find((a) => a.id === row.accountId)?.kind === "tracking") continue;
    if (!used.has(row.id)) return "missing-source-review";
  }
  for (const event of facts.events) {
    const source = snapshot.sourceRows.find((r) => r.id === event.sourceId);
    if (source?.transactionId && event.id !== source.transactionId)
      return "duplicate-source-live-effect";
  }
  return null;
}
export function validateActivation(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  coverage: BudgetCoverage,
  today: string,
): BudgetResult<true> {
  if (snapshot.setupState === "open") return { ok: false, reason: "setup-incomplete" };
  if (facts.startMonth > today.slice(0, 7)) return { ok: false, reason: "future-start-month" };
  if (
    !parseDate(coverage.throughDate).ok ||
    coverage.throughDate !== today ||
    !coverage.evidence.trim()
  )
    return { ok: false, reason: "incomplete-activity-coverage" };
  if (facts.events.some((e) => e.date > today)) return { ok: false, reason: "future-activity" };
  const range = budgetMonths(facts.startMonth, today.slice(0, 7));
  if (!range.ok) return range;
  for (const month of range.value)
    for (const category of facts.categories)
      if (!facts.assignments.some((a) => a.month === month && a.categoryId === category.id))
        return { ok: false, reason: "missing-month-assignment" };
  const reason =
    budgetRelationships(snapshot, facts) ??
    accountBoundary(snapshot, facts, coverage) ??
    transactionCoverage(snapshot, facts, coverage) ??
    sourceCoverage(snapshot, facts, coverage) ??
    currentAccountBalances(snapshot, facts);
  return reason === null ? { ok: true, value: true } : { ok: false, reason };
}
