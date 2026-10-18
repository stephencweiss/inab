import { parseDate, isUtcTimestamp } from "../lib/date.js";
import { validateCents } from "../lib/money.js";
import type {
  AccountRuntime,
  Snapshot,
  SnapshotPreview,
  SnapshotResult,
  SnapshotSession,
  SnapshotStore,
  StoredAccount,
} from "./ports.js";

function validInput(date: string, cents: number): SnapshotResult<null> {
  return parseDate(date).ok && validateCents(cents, "snapshot").ok
    ? { ok: true, value: null }
    : { ok: false, reason: "invalid-snapshot" };
}
function tracking(session: SnapshotSession, id: string): SnapshotResult<StoredAccount> {
  const account = session.account(id);
  if (account === null) return { ok: false, reason: "account-unavailable" };
  if (account.kind !== "tracking") return { ok: false, reason: "tracking-only" };
  return { ok: true, value: account };
}
function validValues(value: SnapshotPreview) {
  const { after, account } = value;
  return !(
    !validInput(after.effectiveDate, after.balanceCents).ok ||
    !after.id ||
    !value.operationId ||
    after.accountId !== account.id ||
    after.source !== "manual" ||
    !isUtcTimestamp(after.observedAt) ||
    !isUtcTimestamp(value.recordedAt) ||
    after.observedAt !== value.recordedAt ||
    !Number.isSafeInteger(account.revision + 1) ||
    !Number.isSafeInteger(after.revision)
  );
}
function validatePreview(
  session: SnapshotSession,
  value: SnapshotPreview,
  today: string,
): SnapshotResult<Snapshot> {
  const { after, before, account } = value;
  const currentAccount = tracking(session, account.id);
  if (!currentAccount.ok) return currentAccount;
  if (JSON.stringify(currentAccount.value) !== JSON.stringify(account))
    return { ok: false, reason: "stale-version" };
  const current = session.get(after.id);
  if (JSON.stringify(current) !== JSON.stringify(before))
    return { ok: false, reason: "stale-version" };
  if (!validValues(value)) return { ok: false, reason: "invalid-snapshot" };
  if (after.effectiveDate > today) return { ok: false, reason: "future-date" };
  if (before === null) {
    if (value.operation !== "snapshot.add" || after.revision !== 1)
      return { ok: false, reason: "invalid-snapshot" };
  } else if (
    value.operation !== "snapshot.correct" ||
    after.id !== before.id ||
    after.accountId !== before.accountId ||
    after.effectiveDate !== before.effectiveDate ||
    after.source !== before.source ||
    after.revision !== before.revision + 1
  )
    return { ok: false, reason: "invalid-snapshot" };
  const duplicate = session
    .list(account.id)
    .find((s) => s.effectiveDate === after.effectiveDate && s.id !== after.id);
  if (duplicate) return { ok: false, reason: "same-date", existing: duplicate };
  return { ok: true, value: after };
}
export function createSnapshots(store: SnapshotStore, runtime: AccountRuntime) {
  function preview(
    session: SnapshotSession,
    account: StoredAccount,
    before: Snapshot | null,
    after: Snapshot,
  ): SnapshotResult<SnapshotPreview> {
    const value = {
      operationId: runtime.id(),
      operation: before === null ? ("snapshot.add" as const) : ("snapshot.correct" as const),
      account,
      before,
      after,
      recordedAt: after.observedAt,
    };
    const valid = validatePreview(session, value, runtime.today());
    return valid.ok ? { ok: true, value } : valid;
  }
  function previewAdd(
    accountId: string,
    effectiveDate: string,
    balanceCents: number,
  ): SnapshotResult<SnapshotPreview> {
    const valid = validInput(effectiveDate, balanceCents);
    if (!valid.ok) return valid;
    return store.read((session) => {
      const result = tracking(session, accountId);
      if (!result.ok) return result;
      return preview(session, result.value, null, {
        id: runtime.id(),
        accountId,
        effectiveDate,
        balanceCents,
        source: "manual",
        observedAt: runtime.now(),
        revision: 1,
      });
    });
  }
  function previewCorrect(
    id: string,
    revision: number,
    balanceCents: number,
  ): SnapshotResult<SnapshotPreview> {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !validateCents(balanceCents, "snapshot").ok
    )
      return { ok: false, reason: "invalid-snapshot" };
    return store.read((session) => {
      const before = session.get(id);
      if (before === null) return { ok: false, reason: "snapshot-unavailable" };
      if (before.revision !== revision) return { ok: false, reason: "stale-version" };
      const result = tracking(session, before.accountId);
      if (!result.ok) return result;
      return preview(session, result.value, before, {
        ...before,
        balanceCents,
        revision: revision + 1,
        observedAt: runtime.now(),
      });
    });
  }
  function commit(
    value: SnapshotPreview,
  ): SnapshotResult<{ operationId: string; snapshot: Snapshot }> {
    try {
      return store.write((session) => {
        const valid = validatePreview(session, value, runtime.today());
        if (!valid.ok) return valid;
        session.save(value);
        return { ok: true, value: { operationId: value.operationId, snapshot: value.after } };
      });
    } catch (error) {
      throw new Error(
        `Operation ID: ${value.operationId}. ${error instanceof Error ? error.message : "Storage failure"}`,
        { cause: error },
      );
    }
  }
  function list(accountId: string): SnapshotResult<Snapshot[]> {
    return store.read((session) => {
      const result = tracking(session, accountId);
      return result.ok ? { ok: true, value: session.list(accountId) } : result;
    });
  }
  return { previewAdd, previewCorrect, commit, list };
}
