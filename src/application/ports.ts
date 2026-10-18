import type { Account, RegisterEntry } from "../accounts/types.js";

export type StoredAccount = Account & { revision: number; createdAt: string };
export type AccountFailure =
  | "invalid-account"
  | "unsafe-cents"
  | "account-unavailable"
  | "stale-version"
  | "posting-in-opening-period"
  | "tracking-opening";
export type AccountResult<T> = { ok: true; value: T } | { ok: false; reason: AccountFailure };
export type AffectedReconciliation = { id: string; cutoffDate: string };
export type AccountPreview = {
  affectedReconciliations: AffectedReconciliation[];
  operationId: string;
  operation: "account.add" | "account.rename" | "account.opening";
  before: StoredAccount | null;
  after: StoredAccount;
  recordedAt: string;
};
export type AccountSession = {
  list: () => StoredAccount[];
  latestSnapshot: (id: string) => Snapshot | null;
  get: (id: string) => StoredAccount | null;
  entries: (id: string) => RegisterEntry[];
  reconciliations: (id: string) => Reconciliation[];
  save: (preview: AccountPreview) => void;
};
export type AccountStore = {
  read: <T>(work: (session: AccountSession) => T) => T;
  write: <T>(work: (session: AccountSession) => T) => T;
};
export type AccountRuntime = { id: () => string; now: () => string; today: () => string };

export type ManualTransaction = RegisterEntry & {
  payee: string;
  memo: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type TransactionInput = Pick<
  ManualTransaction,
  "occurredOn" | "postedOn" | "cents" | "payee" | "memo"
>;
export type TransactionFailure =
  | "invalid-transaction"
  | "account-unavailable"
  | "transaction-unavailable"
  | "stale-version"
  | "tracking-register"
  | "unsafe-cents"
  | "posting-in-opening-period"
  | "posting-before-occurrence"
  | "future-date";
export type TransactionResult<T> =
  { ok: true; value: T } | { ok: false; reason: TransactionFailure };
export type TransactionPreview = {
  affectedReconciliations: AffectedReconciliation[];
  operationId: string;
  operation: "transaction.add" | "transaction.edit" | "transaction.clear" | "transaction.unclear";
  account: StoredAccount;
  before: ManualTransaction | null;
  after: ManualTransaction;
  recordedAt: string;
};
export type TransactionSession = {
  reconciliations: (id: string) => Reconciliation[];
  account: (id: string) => StoredAccount | null;
  get: (id: string) => ManualTransaction | null;
  entries: (id: string) => ManualTransaction[];
  save: (preview: TransactionPreview) => void;
};
export type TransactionStore = {
  read: <T>(work: (session: TransactionSession) => T) => T;
  write: <T>(work: (session: TransactionSession) => T) => T;
};

export type Reconciliation = import("../accounts/reconciliation.js").ReconciliationSnapshot & {
  id: string;
  status: "valid" | "needs-review";
  recordedAt: string;
};
export type ReconciliationPreview =
  import("../accounts/reconciliation.js").ReconciliationSnapshot & {
    operationId: string;
    recordedAt: string;
  };
export type ReconciliationFailure =
  | "account-unavailable"
  | "stale-version"
  | "balance-mismatch"
  | "invalid-reconciliation"
  | "invalid-date"
  | "cutoff-before-opening"
  | "future-date"
  | "tracking-register"
  | "unsafe-cents";
export type ReconciliationResult<T> =
  { ok: true; value: T } | { ok: false; reason: ReconciliationFailure };
export type ReconciliationSession = {
  account: (id: string) => StoredAccount | null;
  entries: (id: string) => ManualTransaction[];
  reconciliations: (id: string) => Reconciliation[];
  save: (preview: ReconciliationPreview) => Reconciliation;
};
export type ReconciliationStore = {
  read: <T>(work: (session: ReconciliationSession) => T) => T;
  write: <T>(work: (session: ReconciliationSession) => T) => T;
};

export type Snapshot = {
  id: string;
  accountId: string;
  effectiveDate: string;
  balanceCents: number;
  source: "manual";
  observedAt: string;
  revision: number;
};
export type SnapshotFailure =
  | "invalid-snapshot"
  | "account-unavailable"
  | "snapshot-unavailable"
  | "stale-version"
  | "tracking-only"
  | "future-date";
export type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: SnapshotFailure }
  | { ok: false; reason: "same-date"; existing: Snapshot };
export type SnapshotPreview = {
  operationId: string;
  operation: "snapshot.add" | "snapshot.correct";
  account: StoredAccount;
  before: Snapshot | null;
  after: Snapshot;
  recordedAt: string;
};
export type SnapshotSession = {
  account: (id: string) => StoredAccount | null;
  get: (id: string) => Snapshot | null;
  list: (accountId: string) => Snapshot[];
  save: (preview: SnapshotPreview) => void;
};
export type SnapshotStore = {
  read: <T>(work: (session: SnapshotSession) => T) => T;
  write: <T>(work: (session: SnapshotSession) => T) => T;
};
export type AccountSummary = StoredAccount & { latestSnapshot: Snapshot | null };

export type RecoveryOperation = "backup" | "restore";
export type RecoveryMetadata = {
  source: string;
  destination: string;
  schemaVersion: number;
  migrationNeeded: boolean;
};
export type RecoveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid-path" | "missing-source" | "invalid-backup"; message: string }
  | {
      ok: false;
      reason: "schema-version";
      message: string;
      schemaVersion: number;
      requiredSchemaVersion: number;
    };
export type RecoverySourceIdentity = { device: number; inode: number };
export type RecoveryInspection = RecoveryMetadata & { sourceIdentity: RecoverySourceIdentity };
export type RecoveryPreview = RecoveryInspection & {
  operation: RecoveryOperation;
  operationId: string;
};
export type RecoveryStore = {
  inspect: (source: string, destination: string) => RecoveryResult<RecoveryInspection>;
  copy: (preview: RecoveryPreview) => Promise<RecoveryResult<RecoveryMetadata>>;
};
