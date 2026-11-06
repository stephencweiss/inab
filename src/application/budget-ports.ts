import type { BudgetFacts, BudgetAllocation, BudgetEvent } from "../budget/types.js";
import type { AccountRuntime, ManualTransaction, StoredAccount } from "./ports.js";
export type BudgetCoverage = {
  throughDate: string;
  evidence: string;
  includedTransactionIds: string[];
  postedBridgeEventIds: string[];
};
export type BudgetReceipt = { operationId: string; revision: number; reviewId: string | null };
export type ActiveBudget = {
  facts: BudgetFacts;
  revision: number;
  status: "active" | "needs-review";
  coverage: BudgetCoverage;
  receipt: BudgetReceipt;
};
export type BudgetSourceRow = {
  id: string;
  accountId: string;
  date: string;
  cents: number;
  role: string;
  transactionId: string | null;
};
export type BudgetSnapshot = {
  targetId: string;
  setupState: string;
  state: ActiveBudget | null;
  accounts: StoredAccount[];
  transactions: ManualTransaction[];
  sourceRows: BudgetSourceRow[];
};
export type BudgetCommand =
  | { kind: "activate"; facts: BudgetFacts; coverage: BudgetCoverage }
  | { kind: "amend-opening"; facts: BudgetFacts; coverage: BudgetCoverage }
  | { kind: "assign"; month: string; categoryId: string; amountCents: number }
  | {
      kind: "move";
      month: string;
      fromCategoryId: string;
      toCategoryId: string;
      amountCents: number;
    }
  | { kind: "category-add"; id: string; groupId: string; name: string }
  | {
      kind: "category-change";
      id: string;
      name: string;
      groupId: string;
      archived: boolean;
      position: number;
    }
  | {
      kind: "allocate";
      transactionId: string;
      expectedTransactionVersion: number;
      allocation: BudgetAllocation;
    }
  | { kind: "historical-correct"; event: BudgetEvent; expectedActivityVersion: number }
  | {
      kind: "transfer";
      fromAccountId: string;
      toAccountId: string;
      date: string;
      amountCents: number;
      categoryId: string | null;
      expectedFromVersion: number;
      expectedToVersion: number;
      fromTransactionId: string | null;
      toTransactionId: string | null;
    }
  | {
      kind: "transfer-edit";
      id: string;
      date: string;
      amountCents: number;
      categoryId: string | null;
      expectedActivityVersion: number;
    }
  | { kind: "transfer-unlink"; id: string; expectedActivityVersion: number };
export type BudgetPreview = {
  command: BudgetCommand;
  baseline: string;
  expectedRevision: number;
  operationId: string;
  recordedAt: string;
  after: BudgetFacts;
  coverage: BudgetCoverage;
  transferLegIds: { from: string; to: string } | null;
};
export type BudgetSession = {
  snapshot: () => BudgetSnapshot;
  receipt: (operationId: string) => { revision: number; afterJson: string } | null;
  save: (preview: BudgetPreview) => void;
};
export type BudgetStore = {
  read: <T>(work: (session: BudgetSession) => T) => T;
  write: <T>(work: (session: BudgetSession) => T) => T;
};
export type BudgetRuntime = AccountRuntime;
export type BudgetResult<T> = { ok: true; value: T } | { ok: false; reason: string };
