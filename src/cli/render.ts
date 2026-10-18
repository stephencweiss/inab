import type { AccountBalances } from "../accounts/balances.js";
import type {
  StoredAccount,
  Snapshot,
  AccountPreview,
  AffectedReconciliation,
} from "../application/ports.js";

export function formatCents(cents: number) {
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function renderAccount(account: StoredAccount) {
  const metadata = `${account.id} | ${account.name} | ${account.kind} | revision ${account.revision}`;
  return account.kind === "tracking"
    ? metadata
    : `${metadata} | opening USD ${formatCents(account.openingCents)} on ${account.openingDate}`;
}
export function renderAccountSummary(account: StoredAccount, latestSnapshot: Snapshot | null) {
  const metadata = renderAccount(account);
  if (account.kind !== "tracking") return metadata;
  const balance =
    latestSnapshot === null
      ? "no balance recorded"
      : `last known USD ${formatCents(latestSnapshot.balanceCents)} on ${latestSnapshot.effectiveDate} | ${latestSnapshot.source}`;
  return `${metadata} | ${balance}`;
}
export function renderPreview(database: string, preview: AccountPreview) {
  return `Database target: ${database}\nOperation ID: ${preview.operationId}\nBefore: ${preview.before === null ? "none" : renderAccount(preview.before)}\nAfter: ${renderAccount(preview.after)}\n${renderAffected(preview.affectedReconciliations)}Cash: inflow positive; outflow negative. Credit debt: negative.\n`;
}

export function renderInspection(
  account: StoredAccount,
  balance: AccountBalances | null,
  latestSnapshot: Snapshot | null = null,
) {
  const description = renderAccountSummary(account, latestSnapshot);
  if (balance === null) return description;
  return `${description}\nWorking USD ${formatCents(balance.workingCents)}\nCleared USD ${formatCents(balance.clearedCents)}\nUncleared USD ${formatCents(balance.unclearedCents)}`;
}

export function renderAffected(records: readonly AffectedReconciliation[]) {
  const lines = records.map((record) => `${record.id} | ${record.cutoffDate}`).join("\n");
  return records.length === 0 ? "" : `Checks to mark needs-review:\n${lines}\n`;
}
