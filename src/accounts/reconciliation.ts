import { balances } from "./balances.js";
import type { Account, RegisterEntry } from "./types.js";
import { checkedSum, validateCents } from "../lib/money.js";
export type ReconciliationEvidence = {
  transactionId: string;
  transactionRevision: number;
  cents: number;
  postedOn: string;
};
export type ReconciliationSnapshot = {
  accountId: string;
  cutoffDate: string;
  bankCents: number;
  computedCents: number;
  differenceCents: number;
  openingCents: number;
  openingDate: string;
  accountRevision: number;
  entries: ReconciliationEvidence[];
};
type VersionedEntry = RegisterEntry & { revision: number };
export function reconciliationSnapshot(
  account: Account & { revision: number },
  entries: readonly VersionedEntry[],
  cutoffDate: string,
  bankCents: number,
) {
  if (!account.id || !Number.isSafeInteger(account.revision) || account.revision < 1)
    return { ok: false as const, reason: "invalid-reconciliation" as const };
  const result = balances(account, entries, cutoffDate);
  if (!result.ok) return result;
  if (account.kind === "tracking")
    return { ok: false as const, reason: "tracking-register" as const };
  const bank = validateCents(bankCents, "snapshot");
  if (!bank.ok) return bank;
  const difference = checkedSum([bankCents, -result.value.clearedCents]);
  if (!difference.ok) return difference;
  const covered: ReconciliationEvidence[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.id ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 1
    )
      return { ok: false as const, reason: "invalid-reconciliation" as const };
    ids.add(entry.id);
    if (entry.postedOn !== null && entry.postedOn <= cutoffDate)
      covered.push({
        transactionId: entry.id,
        transactionRevision: entry.revision,
        cents: entry.cents,
        postedOn: entry.postedOn,
      });
  }
  return {
    ok: true as const,
    value: {
      accountId: account.id,
      cutoffDate,
      bankCents,
      computedCents: result.value.clearedCents,
      differenceCents: difference.value,
      openingCents: account.openingCents,
      openingDate: account.openingDate,
      accountRevision: account.revision,
      entries: covered.toSorted((a, b) => a.transactionId.localeCompare(b.transactionId)),
    },
  };
}
/** Compare the complete covered set, account membership, opening pair, amounts and posting dates.
 * Revisions are evidence of the original record; metadata-only edits do not remove coverage.
 */
export function evidenceMatches(
  snapshot: ReconciliationSnapshot,
  account: Account & { revision: number },
  entries: readonly VersionedEntry[],
) {
  if (account.id !== snapshot.accountId) return false;
  const current = reconciliationSnapshot(account, entries, snapshot.cutoffDate, snapshot.bankCents);
  if (!current.ok) return false;
  return (
    current.value.differenceCents === 0 &&
    snapshot.differenceCents === 0 &&
    current.value.computedCents === snapshot.computedCents &&
    current.value.openingCents === snapshot.openingCents &&
    current.value.openingDate === snapshot.openingDate &&
    current.value.entries.length === snapshot.entries.length &&
    current.value.entries.every((entry) =>
      snapshot.entries.some(
        (old) =>
          old.transactionId === entry.transactionId &&
          old.cents === entry.cents &&
          old.postedOn === entry.postedOn,
      ),
    )
  );
}

export type ReconciliationReference = { id: string; cutoffDate: string };
type ReviewableReconciliation = ReconciliationReference & { status: "valid" | "needs-review" };
/** A null boundary selects every stored valid check, for an opening correction. */
export function affectedReconciliations(
  records: readonly ReviewableReconciliation[],
  earliestPosting: string | null,
): ReconciliationReference[] {
  return records
    .filter(
      (record) =>
        record.status === "valid" &&
        (earliestPosting === null || record.cutoffDate >= earliestPosting),
    )
    .map(({ id, cutoffDate }) => ({ id, cutoffDate }))
    .toSorted((a, b) => a.cutoffDate.localeCompare(b.cutoffDate) || a.id.localeCompare(b.id));
}
/** A null result means no posted balance changed; do not invalidate any check. */
export function correctionPostingDate(
  before: RegisterEntry | null,
  after: RegisterEntry,
): string | null {
  if (before !== null && before.postedOn === after.postedOn && before.cents === after.cents)
    return null;
  const dates = [before?.postedOn ?? null, after.postedOn].filter((date) => date !== null);
  return dates.toSorted((a, b) => a.localeCompare(b))[0] ?? null;
}
