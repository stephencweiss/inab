import { evidenceMatches } from "../accounts/reconciliation.js";
import { orderRegisterEntries } from "../accounts/register.js";
import { balances, validateRegisterEntry } from "../accounts/balances.js";
import type { AccountBalances } from "../accounts/balances.js";
import { parseDate } from "../lib/date.js";
import { validateCents } from "../lib/money.js";
import type {
  AccountRuntime,
  ManualTransaction,
  StoredAccount,
  TransactionInput,
  TransactionPreview,
  TransactionResult,
  TransactionSession,
  TransactionStore,
} from "./ports.js";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseTransactionInput(input: unknown): TransactionResult<TransactionInput> {
  if (
    !isRecord(input) ||
    typeof input.occurredOn !== "string" ||
    !parseDate(input.occurredOn).ok ||
    (input.postedOn !== null &&
      (typeof input.postedOn !== "string" || !parseDate(input.postedOn).ok)) ||
    typeof input.cents !== "number" ||
    !validateCents(input.cents, "transaction").ok ||
    typeof input.payee !== "string" ||
    !input.payee.trim() ||
    typeof input.memo !== "string"
  )
    return { ok: false, reason: "invalid-transaction" };
  return {
    ok: true,
    value: {
      occurredOn: input.occurredOn,
      postedOn: input.postedOn,
      cents: input.cents,
      payee: input.payee.trim(),
      memo: input.memo,
    },
  };
}
function affectsReconciliation(before: ManualTransaction | null, after: ManualTransaction) {
  return (
    (before?.postedOn !== after.postedOn || before?.cents !== after.cents) &&
    (before?.postedOn != null || after.postedOn !== null)
  );
}
function validateChange(
  session: TransactionSession,
  account: StoredAccount,
  before: ManualTransaction | null,
  after: ManualTransaction,
  today: string,
): TransactionResult<ManualTransaction> {
  if (account.kind === "tracking") return { ok: false, reason: "tracking-register" };
  if (
    !parseTransactionInput(after).ok ||
    !Number.isSafeInteger(after.revision) ||
    after.revision < 1 ||
    !Number.isSafeInteger(account.revision + 1)
  )
    return { ok: false, reason: "invalid-transaction" };
  const valid = validateRegisterEntry(account, after, today);
  if (!valid.ok) {
    if (valid.reason === "future-activity") return { ok: false, reason: "future-date" };
    if (
      valid.reason === "posting-in-opening-period" ||
      valid.reason === "posting-before-occurrence" ||
      valid.reason === "unsafe-cents"
    )
      return { ok: false, reason: valid.reason };
    return { ok: false, reason: "invalid-transaction" };
  }
  if (affectsReconciliation(before, after) && session.hasReconciliations(account.id))
    return { ok: false, reason: "reconciled-transaction" };
  const entries = orderRegisterEntries([
    ...session.entries(account.id).filter((e) => e.id !== after.id),
    after,
  ]);
  const total = balances(
    account,
    entries,
    today < account.openingDate ? account.openingDate : today,
  );
  if (!total.ok)
    return {
      ok: false,
      reason: total.reason === "unsafe-cents" ? "unsafe-cents" : "invalid-transaction",
    };
  return { ok: true, value: after };
}
function validPreview(preview: TransactionPreview, current: ManualTransaction | null) {
  const { after, before, operation } = preview;
  if (JSON.stringify(before) !== JSON.stringify(current)) return false;
  if (current === null) return operation === "transaction.add" && after.revision === 1;
  if (
    after.id !== current.id ||
    after.accountId !== current.accountId ||
    after.createdAt !== current.createdAt ||
    after.revision !== current.revision + 1
  )
    return false;
  if (operation === "transaction.edit") return after.postedOn === current.postedOn;
  if (operation !== "transaction.clear" && operation !== "transaction.unclear") return false;
  return (
    after.cents === current.cents &&
    after.occurredOn === current.occurredOn &&
    after.payee === current.payee &&
    after.memo === current.memo &&
    (operation === "transaction.clear" ? after.postedOn !== null : after.postedOn === null)
  );
}
export function createTransactions(store: TransactionStore, runtime: AccountRuntime) {
  function preview(
    session: TransactionSession,
    operation: TransactionPreview["operation"],
    account: StoredAccount,
    before: ManualTransaction | null,
    after: ManualTransaction,
  ): TransactionResult<TransactionPreview> {
    const result = validateChange(session, account, before, after, runtime.today());
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        operationId: runtime.id(),
        operation,
        account,
        before,
        after,
        recordedAt: runtime.now(),
      },
    };
  }
  function previewAdd(
    accountId: string,
    input: TransactionInput,
  ): TransactionResult<TransactionPreview> {
    const parsed = parseTransactionInput(input);
    if (!parsed.ok) return parsed;
    return store.read((session) => {
      const account = session.account(accountId);
      if (account === null) return { ok: false, reason: "account-unavailable" };
      const now = runtime.now();
      return preview(session, "transaction.add", account, null, {
        ...parsed.value,
        id: runtime.id(),
        accountId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
  function previewChange(
    id: string,
    revision: number,
    operation: TransactionPreview["operation"],
    update: (entry: ManualTransaction) => ManualTransaction,
  ): TransactionResult<TransactionPreview> {
    if (!Number.isSafeInteger(revision) || revision < 1)
      return { ok: false, reason: "invalid-transaction" };
    return store.read((session) => {
      const before = session.get(id);
      if (before === null) return { ok: false, reason: "transaction-unavailable" };
      if (before.revision !== revision) return { ok: false, reason: "stale-version" };
      const account = session.account(before.accountId);
      if (account === null) return { ok: false, reason: "account-unavailable" };
      return preview(session, operation, account, before, {
        ...update(before),
        revision: revision + 1,
        updatedAt: runtime.now(),
      });
    });
  }
  function previewEdit(id: string, revision: number, input: Omit<TransactionInput, "postedOn">) {
    return previewChange(id, revision, "transaction.edit", (entry) => ({
      ...entry,
      occurredOn: input.occurredOn,
      cents: input.cents,
      payee: input.payee.trim(),
      memo: input.memo,
    }));
  }
  function previewClear(id: string, revision: number, postedOn: string) {
    return previewChange(id, revision, "transaction.clear", (entry) => ({ ...entry, postedOn }));
  }
  function previewUnclear(id: string, revision: number) {
    return previewChange(id, revision, "transaction.unclear", (entry) => ({
      ...entry,
      postedOn: null,
    }));
  }
  function commit(value: TransactionPreview): TransactionResult<{
    operationId: string;
    transaction: ManualTransaction;
    accountRevision: number;
  }> {
    try {
      return store.write((session) => {
        const account = session.account(value.after.accountId);
        if (account === null) return { ok: false, reason: "account-unavailable" };
        const current = session.get(value.after.id);
        if (
          account.revision !== value.account.revision ||
          (current?.revision ?? null) !== (value.before?.revision ?? null)
        )
          return { ok: false, reason: "stale-version" };
        if (value.account.id !== account.id || !validPreview(value, current))
          return { ok: false, reason: "invalid-transaction" };
        const valid = validateChange(session, account, current, value.after, runtime.today());
        if (!valid.ok) return valid;
        session.save(value);
        return {
          ok: true,
          value: {
            operationId: value.operationId,
            transaction: value.after,
            accountRevision: account.revision + 1,
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
  function register(id: string): TransactionResult<{
    account: StoredAccount;
    entries: (ManualTransaction & { clearance: "uncleared" | "cleared" | "reconciled" })[];
    balances: AccountBalances;
  }> {
    return store.read((session) => {
      const account = session.account(id);
      if (account === null) return { ok: false, reason: "account-unavailable" };
      if (account.kind === "tracking") return { ok: false, reason: "tracking-register" };
      const entries = orderRegisterEntries(session.entries(id));
      const result = balances(
        account,
        entries,
        account.openingDate > runtime.today() ? account.openingDate : runtime.today(),
      );
      if (!result.ok)
        return {
          ok: false,
          reason: result.reason === "unsafe-cents" ? "unsafe-cents" : "invalid-transaction",
        };
      const valid = session
        .reconciliations(id)
        .filter((record) => record.status === "valid" && evidenceMatches(record, account, entries));
      const coveredIds = new Set(
        valid.flatMap((record) => record.entries.map((evidence) => evidence.transactionId)),
      );
      const displayed = entries.map((entry) => {
        if (entry.postedOn === null) return { ...entry, clearance: "uncleared" as const };
        return {
          ...entry,
          clearance: coveredIds.has(entry.id) ? ("reconciled" as const) : ("cleared" as const),
        };
      });
      return { ok: true, value: { account, entries: displayed, balances: result.value } };
    });
  }
  return { previewAdd, previewEdit, previewClear, previewUnclear, commit, register };
}
