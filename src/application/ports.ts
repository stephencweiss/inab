import type { Account, RegisterEntry } from "../accounts/types.js";

export type StoredAccount = Account & { revision: number; createdAt: string };
export type AccountFailure =
  | "invalid-account"
  | "unsafe-cents"
  | "account-unavailable"
  | "stale-version"
  | "posting-in-opening-period"
  | "reconciled-opening"
  | "tracking-opening";
export type AccountResult<T> = { ok: true; value: T } | { ok: false; reason: AccountFailure };
export type AccountPreview = {
  operationId: string;
  operation: "account.add" | "account.rename" | "account.opening";
  before: StoredAccount | null;
  after: StoredAccount;
  recordedAt: string;
};
export type AccountSession = {
  get: (id: string) => StoredAccount | null;
  entries: (id: string) => RegisterEntry[];
  hasReconciliations: (id: string) => boolean;
  save: (preview: AccountPreview) => void;
};
export type AccountStore = {
  list: () => StoredAccount[];
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
  | "future-date"
  | "reconciled-transaction";
export type TransactionResult<T> =
  { ok: true; value: T } | { ok: false; reason: TransactionFailure };
export type TransactionPreview = {
  operationId: string;
  operation: "transaction.add" | "transaction.edit" | "transaction.clear" | "transaction.unclear";
  account: StoredAccount;
  before: ManualTransaction | null;
  after: ManualTransaction;
  recordedAt: string;
};
export type TransactionSession = {
  account: (id: string) => StoredAccount | null;
  get: (id: string) => ManualTransaction | null;
  entries: (id: string) => ManualTransaction[];
  hasReconciliations: (id: string) => boolean;
  save: (preview: TransactionPreview) => void;
};
export type TransactionStore = {
  read: <T>(work: (session: TransactionSession) => T) => T;
  write: <T>(work: (session: TransactionSession) => T) => T;
};
