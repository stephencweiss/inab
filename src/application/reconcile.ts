import type { ReconciliationSnapshot } from "../accounts/reconciliation.js";
import { reconciliationSnapshot, evidenceMatches } from "../accounts/reconciliation.js";
import { orderRegisterEntries } from "../accounts/register.js";
import { parseDate } from "../lib/date.js";
import type {
  AccountRuntime,
  Reconciliation,
  ReconciliationPreview,
  ReconciliationResult,
  ReconciliationSession,
  ReconciliationStore,
} from "./ports.js";
function compare(
  session: ReconciliationSession,
  id: string,
  cutoff: string,
  bankCents: number,
  today: string,
): ReconciliationResult<ReconciliationSnapshot> {
  const account = session.account(id);
  if (account === null) return { ok: false, reason: "account-unavailable" };
  if (!parseDate(cutoff).ok || !parseDate(today).ok) return { ok: false, reason: "invalid-date" };
  if (cutoff > today) return { ok: false, reason: "future-date" };
  const result = reconciliationSnapshot(
    account,
    orderRegisterEntries(session.entries(id)),
    cutoff,
    bankCents,
  );
  if (!result.ok) {
    const reason = result.reason;
    if (
      reason === "invalid-date" ||
      reason === "cutoff-before-opening" ||
      reason === "tracking-register" ||
      reason === "unsafe-cents"
    )
      return { ok: false, reason };
    return { ok: false, reason: "invalid-reconciliation" };
  }
  return result;
}
function validRecordedAt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"))
  );
}
export function createReconciliations(store: ReconciliationStore, runtime: AccountRuntime) {
  function preview(
    id: string,
    cutoff: string,
    bankCents: number,
  ): ReconciliationResult<ReconciliationPreview> {
    return store.read((session) => {
      const result = compare(session, id, cutoff, bankCents, runtime.today());
      if (!result.ok) return result;
      return {
        ok: true,
        value: { ...result.value, operationId: runtime.id(), recordedAt: runtime.now() },
      };
    });
  }
  function list(id: string): ReconciliationResult<Reconciliation[]> {
    return store.read((session) => {
      const account = session.account(id);
      if (account === null) return { ok: false, reason: "account-unavailable" };
      if (account.kind === "tracking") return { ok: false, reason: "tracking-register" };
      const entries = orderRegisterEntries(session.entries(id));
      return {
        ok: true,
        value: session.reconciliations(id).map((record) => ({
          ...record,
          status:
            record.status === "valid" && evidenceMatches(record, account, entries)
              ? "valid"
              : "needs-review",
        })),
      };
    });
  }
  function commit(value: ReconciliationPreview): ReconciliationResult<{
    operationId: string | null;
    reused: boolean;
    reconciliation: Reconciliation;
  }> {
    try {
      return store.write((session) => {
        const current = compare(
          session,
          value.accountId,
          value.cutoffDate,
          value.bankCents,
          runtime.today(),
        );
        if (!current.ok) return current;
        if (current.value.accountRevision !== value.accountRevision)
          return { ok: false, reason: "stale-version" };
        if (current.value.differenceCents !== 0) return { ok: false, reason: "balance-mismatch" };
        const { operationId, recordedAt, ...snapshot } = value;
        if (
          !operationId ||
          !validRecordedAt(recordedAt) ||
          JSON.stringify(snapshot) !== JSON.stringify(current.value)
        )
          return { ok: false, reason: "invalid-reconciliation" };
        const old = session
          .reconciliations(value.accountId)
          .find(
            (record) =>
              record.cutoffDate === value.cutoffDate &&
              record.accountRevision === value.accountRevision,
          );
        if (old) {
          const account = session.account(value.accountId);
          if (
            account === null ||
            old.status !== "valid" ||
            old.bankCents !== value.bankCents ||
            !evidenceMatches(old, account, orderRegisterEntries(session.entries(value.accountId)))
          )
            return { ok: false, reason: "invalid-reconciliation" };
          return { ok: true, value: { operationId: null, reused: true, reconciliation: old } };
        }
        return {
          ok: true,
          value: { operationId, reused: false, reconciliation: session.save(value) },
        };
      });
    } catch (error) {
      throw new Error(
        `Operation ID: ${value.operationId}. ${error instanceof Error ? error.message : "Storage failure"}`,
        { cause: error },
      );
    }
  }
  return { preview, commit, list };
}
