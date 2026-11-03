import type { ImportReceipt } from "./import-ports.js";
import { parseDate } from "../lib/date.js";
export type HistoricalAccount = {
  accountId: string;
  name: string;
  kind: "cash" | "credit" | "tracking";
  closed: boolean;
  importId: string;
  sourceLabel: string;
  groupKey: string;
};
export type HistoricalRegisterRow = {
  id: string;
  importId: string;
  accountId: string;
  sourceId: string;
  ordinal: number;
  occurredOn: string;
  postedOn: string | null;
  cents: number;
  treatment: "history" | "pending" | "posted";
  role: "transaction" | "adjustment" | "opening";
  disposition: "history-only" | "live-linked" | "observation-evidence";
  original: Record<string, string>;
  normalizedJson: string;
};
export type HistoricalObservation = {
  id: string;
  importId: string;
  accountId: string;
  sourceRowId: string;
  effectiveDate: string;
  observedCents: number;
  originalAdjustmentCents: number;
  currentAdjustmentCents: number | null;
  state: "verified" | "needs-review" | "unverified";
  metadataJson: string;
};
export type HistoricalRegister = {
  accountId: string;
  limit: number;
  offset: number;
  posted: HistoricalRegisterRow[];
  unverified: HistoricalRegisterRow[];
  observations: HistoricalObservation[];
};
export type HistoricalPlanRow = {
  id: string;
  importId: string;
  sourceId: string;
  ordinal: number;
  month: string;
  group: string;
  category: string;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  disposition: "history-only";
  original: Record<string, string>;
  normalizedJson: string;
};
export type HistoricalPlan = {
  month: string;
  limit: number;
  offset: number;
  rows: HistoricalPlanRow[];
};
export type ImportHistoryStore = {
  accounts: () => HistoricalAccount[];
  register: (accountId: string, limit: number, offset: number) => HistoricalRegister;
  plan: (month: string, limit: number, offset: number) => HistoricalPlan;
  report: (importId: string) => ImportReceipt | null;
};
function validatePage(limit: number, offset: number) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error("invalid-pagination");
}
export function createImportHistory(store: ImportHistoryStore) {
  return {
    accounts: () => store.accounts(),
    register: (accountId: string, limit = 100, offset = 0) => {
      validatePage(limit, offset);
      return store.register(accountId, limit, offset);
    },
    plan: (month: string, limit = 100, offset = 0) => {
      validatePage(limit, offset);
      if (!/^\d{4}-\d{2}$/.test(month) || !parseDate(`${month}-01`).ok)
        throw new Error("invalid-month");
      return store.plan(month, limit, offset);
    },
    report: (importId: string) => store.report(importId),
  };
}
