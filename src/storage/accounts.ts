import { readSnapshots } from "./snapshots.js";
import { readReconciliations, invalidateReconciliations } from "./reconciliations.js";
import { orderRegisterEntries } from "../accounts/register.js";
import { eq } from "drizzle-orm";
import type { AccountPreview, AccountSession, AccountStore } from "../application/ports.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { parseAccountRow, parseManualTransactionRow } from "./rows.js";
import { accounts } from "./schema/accounts.js";
import { changes } from "./schema/changes.js";
import { transactions } from "./schema/transactions.js";

type Connection = ReturnType<typeof openDatabase>;
type Queries = Pick<Connection["db"], "select" | "insert" | "update">;
function sessionFor(db: Queries): AccountSession {
  return {
    list: () =>
      db
        .select()
        .from(accounts)
        .orderBy(accounts.createdAt, accounts.id)
        .all()
        .map(parseAccountRow),
    latestSnapshot: (id) => readSnapshots(db, id).at(-1) ?? null,
    get: (id) => {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row ? parseAccountRow(row) : null;
    },
    entries: (id) =>
      orderRegisterEntries(
        db
          .select()
          .from(transactions)
          .where(eq(transactions.accountId, id))
          .all()
          .map(parseManualTransactionRow),
      ),
    reconciliations: (id) => readReconciliations(db, id),
    save: (value) => save(db, value),
  };
}
function save(db: Queries, value: AccountPreview) {
  invalidateReconciliations(db, value.affectedReconciliations, value.operationId, value.recordedAt);
  if (value.before === null) db.insert(accounts).values(value.after).run();
  else db.update(accounts).set(value.after).where(eq(accounts.id, value.after.id)).run();
  db.insert(changes)
    .values({
      id: value.operationId,
      operation: value.operation,
      entityId: value.after.id,
      beforeJson: value.before === null ? null : JSON.stringify(value.before),
      afterJson: JSON.stringify(value.after),
      recordedAt: value.recordedAt,
    })
    .run();
}
export function createAccountStore(path: string): AccountStore {
  function connect() {
    const connection = openDatabase(path);
    try {
      const version = validateMigrationHistory(connection.sqlite, migrationsFolder);
      if (version.applied !== version.latest)
        throw new Error("Database schema is out of date. Run db:migrate.");
      return connection;
    } catch (error) {
      connection.sqlite.close();
      throw error;
    }
  }
  return {
    read: (work) => {
      const connection = connect();
      try {
        return connection.db.transaction((tx) => work(sessionFor(tx)));
      } finally {
        connection.sqlite.close();
      }
    },
    write: (work) => {
      const connection = connect();
      try {
        return connection.db.transaction((tx) => work(sessionFor(tx)), {
          behavior: "immediate",
        });
      } finally {
        connection.sqlite.close();
      }
    },
  };
}
