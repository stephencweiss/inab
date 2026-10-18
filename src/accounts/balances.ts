import { parseDate } from "../lib/date.js";
import { checkedSum, validateCents } from "../lib/money.js";
import type { MoneyFailure } from "../lib/money.js";
import type { Account, RegisterAccount, RegisterEntry } from "./types.js";

type BalanceFailure =
  | MoneyFailure
  | "invalid-date"
  | "tracking-register"
  | "wrong-account"
  | "posting-in-opening-period"
  | "posting-before-occurrence"
  | "cutoff-before-opening"
  | "future-activity";
type Result<T> = { ok: true; value: T } | { ok: false; reason: BalanceFailure };
export type AccountBalances = {
  workingCents: number;
  clearedCents: number;
  unclearedCents: number;
};

function validateEntry(account: RegisterAccount, entry: RegisterEntry): Result<RegisterEntry> {
  if (entry.accountId !== account.id) return { ok: false, reason: "wrong-account" };
  const amount = validateCents(entry.cents, "transaction");
  if (!amount.ok) return amount;
  if (!parseDate(entry.occurredOn).ok) return { ok: false, reason: "invalid-date" };
  if (entry.postedOn !== null) {
    if (!parseDate(entry.postedOn).ok) return { ok: false, reason: "invalid-date" };
    if (entry.postedOn <= account.openingDate)
      return { ok: false, reason: "posting-in-opening-period" };
    if (entry.postedOn < entry.occurredOn)
      return { ok: false, reason: "posting-before-occurrence" };
  }
  return { ok: true, value: entry };
}

/** Call at the write boundary with the current local date, independent of a report cutoff. */
export function validateRegisterEntry(
  account: RegisterAccount,
  entry: RegisterEntry,
  today: string,
): Result<RegisterEntry> {
  if (!parseDate(today).ok || !parseDate(account.openingDate).ok)
    return { ok: false, reason: "invalid-date" };
  const result = validateEntry(account, entry);
  if (!result.ok) return result;
  if (entry.occurredOn > today || (entry.postedOn !== null && entry.postedOn > today)) {
    return { ok: false, reason: "future-activity" };
  }
  return result;
}

/** Working includes the whole register; only cleared is limited by the cutoff. */
export function balances(
  account: Account,
  entries: readonly RegisterEntry[],
  cutoff: string,
): Result<AccountBalances> {
  if (account.kind === "tracking") return { ok: false, reason: "tracking-register" };
  if (!parseDate(account.openingDate).ok || !parseDate(cutoff).ok)
    return { ok: false, reason: "invalid-date" };
  if (cutoff < account.openingDate) return { ok: false, reason: "cutoff-before-opening" };
  const opening = validateCents(account.openingCents, "opening");
  if (!opening.ok) return opening;
  for (const entry of entries) {
    const valid = validateEntry(account, entry);
    if (!valid.ok) return valid;
  }
  const working = checkedSum([account.openingCents, ...entries.map((entry) => entry.cents)]);
  if (!working.ok) return working;
  const cleared = checkedSum([
    account.openingCents,
    ...entries
      .filter((entry) => entry.postedOn !== null && entry.postedOn <= cutoff)
      .map((entry) => entry.cents),
  ]);
  if (!cleared.ok) return cleared;
  const uncleared = checkedSum(
    entries.filter((entry) => entry.postedOn === null).map((entry) => entry.cents),
  );
  if (!uncleared.ok) return uncleared;
  return {
    ok: true,
    value: {
      workingCents: working.value,
      clearedCents: cleared.value,
      unclearedCents: uncleared.value,
    },
  };
}
