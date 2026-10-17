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
