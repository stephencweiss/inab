import { createBudget } from "./application/budget.js";
import { createBudgetStore } from "./storage/budget.js";
import { createSetup } from "./application/setup.js";
import { createSetupStore } from "./storage/setup.js";
import { createMigration } from "./application/imports.js";
import { createImportStore } from "./storage/imports.js";
import { createImportHistory } from "./application/import-history.js";
import { createImportHistoryStore } from "./storage/import-history.js";
import { readSources } from "./adapters/ynab/files.js";
import {
  readReview,
  createReview,
  writeReview,
  updateReview,
  withReviewLock,
} from "./adapters/ynab/review-file.js";
import { createRecovery } from "./application/backup.js";
import { createRecoveryStore } from "./storage/backup.js";
import { createSnapshots } from "./application/snapshots.js";
import { createSnapshotStore } from "./storage/snapshots.js";
import { createReconciliations } from "./application/reconcile.js";
import { createReconciliationStore } from "./storage/reconciliations.js";
import { createTransactions } from "./application/transactions.js";
import { createTransactionStore } from "./storage/transactions.js";
import { randomUUID } from "node:crypto";
import { createAccounts } from "./application/accounts.js";
import { createAccountStore } from "./storage/accounts.js";
export { initializeDatabase, upgradeDatabase } from "./storage/database.js";

export function localToday() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function accountApplication(path: string) {
  return createAccounts(createAccountStore(path), {
    id: randomUUID,
    now: () => new Date().toISOString(),
    today: localToday,
  });
}

export function transactionApplication(path: string) {
  return createTransactions(createTransactionStore(path), {
    id: randomUUID,
    now: () => new Date().toISOString(),
    today: localToday,
  });
}

export function reconciliationApplication(path: string) {
  return createReconciliations(createReconciliationStore(path), {
    id: randomUUID,
    now: () => new Date().toISOString(),
    today: localToday,
  });
}

export function snapshotApplication(path: string) {
  return createSnapshots(createSnapshotStore(path), {
    id: randomUUID,
    now: () => new Date().toISOString(),
    today: localToday,
  });
}

export function recoveryApplication() {
  return createRecovery(createRecoveryStore(), randomUUID);
}

export function setupApplication(path: string) {
  return createSetup(createSetupStore(path), { now: () => new Date().toISOString() });
}
export function migrationApplication(path: string) {
  return createMigration(
    { readSources, readReview, createReview, writeReview, updateReview, withReviewLock },
    createImportStore(path),
    { id: randomUUID, now: () => new Date().toISOString(), today: localToday },
  );
}
export function importHistoryApplication(path: string) {
  return createImportHistory(createImportHistoryStore(path));
}

export function budgetApplication(path: string) {
  return createBudget(createBudgetStore(path), {
    id: randomUUID,
    now: () => new Date().toISOString(),
    today: localToday,
  });
}
import { createBudgetReviewFiles } from "./adapters/budget/review-file.js";
import { parseBudgetFacts } from "./budget/parse.js";
export const {
  createBudgetReview,
  readBudgetReview,
  updateBudgetReview,
  withBudgetReviewLock,
  writeBudgetReview,
} = createBudgetReviewFiles(parseBudgetFacts);
export { parseBudgetCoverage } from "./adapters/budget/review-file.js";
export type { BudgetReview } from "./adapters/budget/review-file.js";
import { createBudgetEditor } from "./adapters/budget/editor.js";
import { parseBudgetCoverage } from "./adapters/budget/review-file.js";
export const budgetDraftEditor = createBudgetEditor((value) => {
  if (!("facts" in value) || !("coverage" in value)) throw new Error("invalid-editor-draft");
  const facts = parseBudgetFacts(value.facts);
  if (!facts.ok) throw new Error(facts.reason);
  return { facts: facts.value, coverage: parseBudgetCoverage(value.coverage) };
});
