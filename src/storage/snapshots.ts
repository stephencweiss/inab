import { eq } from "drizzle-orm";
import type { SnapshotPreview, SnapshotSession, SnapshotStore } from "../application/ports.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { parseAccountRow, parseSnapshotRow } from "./rows.js";
import { accounts } from "./schema/accounts.js";
import { changes } from "./schema/changes.js";
import { snapshots } from "./schema/snapshots.js";
type Connection = ReturnType<typeof openDatabase>;
type Queries = Pick<Connection["db"], "select" | "insert" | "update">;
export function readSnapshots(db: Pick<Queries, "select">, accountId: string) {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.accountId, accountId))
    .orderBy(snapshots.effectiveDate, snapshots.id)
    .all()
    .map(parseSnapshotRow);
}
function save(db: Queries, preview: SnapshotPreview) {
  if (preview.before === null) db.insert(snapshots).values(preview.after).run();
  else db.update(snapshots).set(preview.after).where(eq(snapshots.id, preview.after.id)).run();
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
function sessionFor(db: Queries): SnapshotSession {
  return {
    account: (id) => {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row ? parseAccountRow(row) : null;
    },
    get: (id) => {
      const row = db.select().from(snapshots).where(eq(snapshots.id, id)).get();
      return row ? parseSnapshotRow(row) : null;
    },
    list: (id) => readSnapshots(db, id),
    save: (value) => save(db, value),
  };
}
export function createSnapshotStore(path: string): SnapshotStore {
  function run<T>(work: (session: SnapshotSession) => T, write: boolean) {
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
