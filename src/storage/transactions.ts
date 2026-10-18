import { readReconciliations, invalidateReconciliations } from "./reconciliations.js";
import { eq } from "drizzle-orm";
import type {
  TransactionPreview,
  TransactionSession,
  TransactionStore,
} from "../application/ports.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { parseAccountRow, parseManualTransactionRow } from "./rows.js";
import { accounts } from "./schema/accounts.js";
import { transactions } from "./schema/transactions.js";
import { changes } from "./schema/changes.js";
type Connection = ReturnType<typeof openDatabase>;
type Queries = Pick<Connection["db"], "select" | "insert" | "update">;
function save(db: Queries, preview: TransactionPreview) {
  invalidateReconciliations(
    db,
    preview.affectedReconciliations,
    preview.operationId,
    preview.recordedAt,
  );
  if (preview.before === null) db.insert(transactions).values(preview.after).run();
  else
    db.update(transactions).set(preview.after).where(eq(transactions.id, preview.after.id)).run();
  db.update(accounts)
    .set({ revision: preview.account.revision + 1 })
    .where(eq(accounts.id, preview.account.id))
    .run();
  db.insert(changes)
    .values({
      id: preview.operationId,
      operation: preview.operation,
      entityId: preview.after.id,
      beforeJson: preview.before === null ? null : JSON.stringify(preview.before),
      afterJson: JSON.stringify(preview.after),
      recordedAt: preview.recordedAt,
    })
    .run();
}
function sessionFor(db: Queries): TransactionSession {
  return {
    reconciliations: (id) => readReconciliations(db, id),
    account: (id) => {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row ? parseAccountRow(row) : null;
    },
    get: (id) => {
      const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
      return row ? parseManualTransactionRow(row) : null;
    },
    entries: (id) =>
      db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, id))
        .orderBy(transactions.occurredOn, transactions.createdAt, transactions.id)
        .all()
        .map(parseManualTransactionRow),
    save: (preview) => save(db, preview),
  };
}
export function createTransactionStore(path: string): TransactionStore {
  function run<T>(work: (session: TransactionSession) => T, write: boolean) {
    const connection = openDatabase(path);
    try {
      const version = validateMigrationHistory(connection.sqlite, migrationsFolder);
      if (version.applied !== version.latest)
        throw new Error("Database schema is out of date. Run db:migrate.");
      return connection.db.transaction((tx) => work(sessionFor(tx)), {
        behavior: write ? "immediate" : "deferred",
      });
    } finally {
      connection.sqlite.close();
    }
  }
  return { read: (work) => run(work, false), write: (work) => run(work, true) };
}
