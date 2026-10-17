import { affectedReconciliations } from "../accounts/reconciliation.js";
import { balances } from "../accounts/balances.js";
import type { AccountBalances } from "../accounts/balances.js";
import type { NewAccount } from "../accounts/types.js";
import { parseDate } from "../lib/date.js";
import { validateCents } from "../lib/money.js";
import type {
  AffectedReconciliation,
  AccountPreview,
  AccountResult,
  AccountRuntime,
  AccountSession,
  AccountStore,
  StoredAccount,
} from "./ports.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseNewAccount(input: unknown): AccountResult<NewAccount> {
  if (
    !isRecord(input) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.currency !== "USD"
  )
    return { ok: false, reason: "invalid-account" };
  const identity = { name: input.name.trim(), currency: "USD" as const };
  if (input.kind === "tracking" && input.openingCents === null && input.openingDate === null)
    return {
      ok: true,
      value: { ...identity, kind: "tracking", openingCents: null, openingDate: null },
    };
  if (
    (input.kind !== "cash" && input.kind !== "credit") ||
    typeof input.openingCents !== "number" ||
    !validateCents(input.openingCents, "opening").ok ||
    !parseDate(input.openingDate).ok ||
    typeof input.openingDate !== "string"
  )
    return { ok: false, reason: "invalid-account" };
  return {
    ok: true,
    value: {
      ...identity,
      kind: input.kind,
      openingCents: input.openingCents,
      openingDate: input.openingDate,
    },
  };
}
function validateOpening(
  session: AccountSession,
  after: StoredAccount,
): AccountResult<StoredAccount> {
  if (after.kind === "tracking") return { ok: false, reason: "tracking-opening" };
  const entries = session.entries(after.id);
  if (entries.some((entry) => entry.postedOn !== null && entry.postedOn <= after.openingDate))
    return { ok: false, reason: "posting-in-opening-period" };
  const cutoff = entries.reduce(
    (date, entry) => (entry.postedOn !== null && entry.postedOn > date ? entry.postedOn : date),
    after.openingDate,
  );
  const computed = balances(after, entries, cutoff);
  if (!computed.ok)
    return {
      ok: false,
      reason: computed.reason === "unsafe-cents" ? "unsafe-cents" : "invalid-account",
    };
  return { ok: true, value: after };
}
function openingAffected(session: AccountSession, before: StoredAccount, after: StoredAccount) {
  return before.openingCents === after.openingCents && before.openingDate === after.openingDate
    ? []
    : affectedReconciliations(session.reconciliations(after.id), null);
}
function existing(
  session: AccountSession,
  id: string,
  revision: number,
): AccountResult<StoredAccount> {
  const account = session.get(id);
  if (account === null) return { ok: false, reason: "account-unavailable" };
  if (account.revision !== revision) return { ok: false, reason: "stale-version" };
  return { ok: true, value: account };
}

function validateEdit(value: AccountPreview, current: StoredAccount) {
  const after = value.after;
  const immutable =
    after.id === current.id &&
    after.kind === current.kind &&
    after.currency === current.currency &&
    after.createdAt === current.createdAt &&
    after.revision === current.revision + 1;
  if (
    !immutable ||
    JSON.stringify(value.before) !== JSON.stringify(current) ||
    !parseNewAccount(after).ok
  )
    return false;
  if (value.operation === "account.rename")
    return after.openingCents === current.openingCents && after.openingDate === current.openingDate;
  return value.operation === "account.opening" && after.name === current.name;
}

function validNewPreview(value: AccountPreview) {
  return (
    value.operation === "account.add" &&
    value.after.revision === 1 &&
    parseNewAccount(value.after).ok
  );
}
function validateAccountPreview(
  session: AccountSession,
  value: AccountPreview,
): AccountResult<StoredAccount> {
  if (value.before === null) {
    if (!validNewPreview(value)) return { ok: false, reason: "invalid-account" };
    if (session.get(value.after.id) !== null) return { ok: false, reason: "stale-version" };
    return { ok: true, value: value.after };
  }
  const current = existing(session, value.before.id, value.before.revision);
  if (!current.ok) return current;
  if (!validateEdit(value, current.value)) return { ok: false, reason: "invalid-account" };
  return value.operation === "account.opening"
    ? validateOpening(session, value.after)
    : { ok: true, value: value.after };
}
export function createAccounts(store: AccountStore, runtime: AccountRuntime) {
  function preview(
    operation: AccountPreview["operation"],
    before: StoredAccount | null,
    after: StoredAccount,
    affected: AffectedReconciliation[],
  ): AccountResult<AccountPreview> {
    return {
      ok: true,
      value: {
        operationId: runtime.id(),
        operation,
        before,
        after,
        recordedAt: runtime.now(),
        affectedReconciliations: affected,
      },
    };
  }
  function previewAdd(input: NewAccount): AccountResult<AccountPreview> {
    const parsed = parseNewAccount(input);
    if (!parsed.ok) return parsed;
    const account = { ...parsed.value, id: runtime.id(), revision: 1, createdAt: runtime.now() };
    return preview("account.add", null, account, []);
  }
  function previewRename(
    id: string,
    revision: number,
    name: string,
  ): AccountResult<AccountPreview> {
    if (!name.trim() || !Number.isSafeInteger(revision) || revision < 1)
      return { ok: false, reason: "invalid-account" };
    return store.read((session) => {
      const result = existing(session, id, revision);
      if (!result.ok) return result;
      if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: "invalid-account" };
      return preview(
        "account.rename",
        result.value,
        {
          ...result.value,
          name: name.trim(),
          revision: revision + 1,
        },
        [],
      );
    });
  }
  function previewOpening(
    id: string,
    revision: number,
    openingCents: number,
    openingDate: string,
  ): AccountResult<AccountPreview> {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !validateCents(openingCents, "opening").ok ||
      !parseDate(openingDate).ok
    )
      return { ok: false, reason: "invalid-account" };
    return store.read((session) => {
      const result = existing(session, id, revision);
      if (!result.ok) return result;
      if (result.value.kind === "tracking") return { ok: false, reason: "tracking-opening" };
      if (!Number.isSafeInteger(revision + 1)) return { ok: false, reason: "invalid-account" };
      const after = { ...result.value, openingCents, openingDate, revision: revision + 1 };
      const valid = validateOpening(session, after);
      if (!valid.ok) return valid;
      return preview(
        "account.opening",
        result.value,
        after,
        openingAffected(session, result.value, after),
      );
    });
  }
  function commit(value: AccountPreview): AccountResult<{
    operationId: string;
    account: StoredAccount;
    affectedReconciliations: AffectedReconciliation[];
  }> {
    try {
      return store.write((session) => {
        const valid = validateAccountPreview(session, value);
        if (!valid.ok) return valid;
        const affected =
          value.before === null ? [] : openingAffected(session, value.before, value.after);
        if (JSON.stringify(affected) !== JSON.stringify(value.affectedReconciliations))
          return { ok: false, reason: "stale-version" };
        session.save(value);
        return {
          ok: true,
          value: {
            operationId: value.operationId,
            account: value.after,
            affectedReconciliations: value.affectedReconciliations,
          },
        };
      });
    } catch (error) {
      throw new Error(
        `Operation ID: ${value.operationId}. ${error instanceof Error ? error.message : "Storage failure"}`,
        { cause: error },
      );
    }
  }
  function show(id: string): AccountResult<StoredAccount> {
    return store.read((session) => {
      const value = session.get(id);
      return value === null ? { ok: false, reason: "account-unavailable" } : { ok: true, value };
    });
  }
  function inspect(
    id: string,
  ): AccountResult<{ account: StoredAccount; balances: AccountBalances | null }> {
    return store.read((session) => {
      const account = session.get(id);
      if (account === null) return { ok: false, reason: "account-unavailable" };
      if (account.kind === "tracking") return { ok: true, value: { account, balances: null } };
      const entries = session.entries(id);
      const cutoff = entries.reduce(
        (date, entry) => (entry.postedOn !== null && entry.postedOn > date ? entry.postedOn : date),
        account.openingDate > runtime.today() ? account.openingDate : runtime.today(),
      );
      const result = balances(account, entries, cutoff);
      if (!result.ok)
        return {
          ok: false,
          reason: result.reason === "unsafe-cents" ? "unsafe-cents" : "invalid-account",
        };
      return { ok: true, value: { account, balances: result.value } };
    });
  }
  return { previewAdd, previewRename, previewOpening, commit, show, list: store.list, inspect };
}
