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
