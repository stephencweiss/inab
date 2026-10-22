import { eq, sql } from "drizzle-orm";
import type { SetupResult, SetupStatus } from "../application/setup-ports.js";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { setup } from "./schema/setup.js";
type Queries = Pick<ReturnType<typeof openDatabase>["db"], "select" | "update" | "all">;
export function setupStatusFrom(db: Queries): SetupStatus {
  const row = db.select().from(setup).where(eq(setup.singleton, 1)).get();
  if (!row) throw new Error("Setup metadata missing. Run db:migrate.");
  return {
    targetId: row.targetId,
    revision: row.revision,
    state: row.state,
    completedAt: row.completedAt,
    importId: row.importId,
  };
}
/** Use inside the same immediate transaction as the household write. All non-metadata tables count. */
export function assertEmptySetup(db: Queries) {
  if (setupStatusFrom(db).state !== "open") throw new Error("setup-closed");
  const tables = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('setup','__drizzle_migrations')`,
  );
  for (const table of tables) {
    const name = table.name.replaceAll('"', '""');
    if (db.all(sql.raw(`SELECT 1 FROM "${name}" LIMIT 1`)).length)
      throw new Error("setup-not-empty");
  }
  return true;
}
/** The caller must validate eligibility before inserting household data in this transaction. */
export function markSetupComplete(
  db: Queries,
  mode: "fresh" | "ynab",
  importId: string | null,
  now: string,
) {
  const before = setupStatusFrom(db);
  if (before.state !== "open") throw new Error("setup-closed");
  db.update(setup)
    .set({ state: mode, importId, completedAt: now, revision: before.revision + 1 })
    .where(eq(setup.singleton, 1))
    .run();
  return setupStatusFrom(db);
}
function currentConnection(path: string) {
  const connection = openDatabase(path);
  try {
    const history = validateMigrationHistory(connection.sqlite, migrationsFolder);
    if (history.applied !== history.latest)
      throw new Error("Database schema is out of date. Run db:migrate.");
    return connection;
  } catch (error) {
    connection.sqlite.close();
    throw error;
  }
}
export function readSetup(path: string) {
  const c = currentConnection(path);
  try {
    return c.db.transaction((tx) => setupStatusFrom(tx));
  } finally {
    c.sqlite.close();
  }
}
export function chooseFresh(path: string, expectedRevision: number, now: string): SetupResult {
  const c = currentConnection(path);
  try {
    return c.db.transaction(
      (tx) => {
        const before = setupStatusFrom(tx);
        if (before.state !== "open") return { ok: false, reason: "setup-closed" };
        if (before.revision !== expectedRevision) return { ok: false, reason: "stale-version" };
        try {
          assertEmptySetup(tx);
        } catch (error) {
          if (error instanceof Error && error.message === "setup-not-empty")
            return { ok: false, reason: "setup-not-empty" };
          throw error;
        }
        return { ok: true, value: markSetupComplete(tx, "fresh", null, now) };
      },
      { behavior: "immediate" },
    );
  } finally {
    c.sqlite.close();
  }
}
export function createSetupStore(path: string) {
  return {
    read: () => readSetup(path),
    chooseFresh: (expectedRevision: number, now: string) =>
      chooseFresh(path, expectedRevision, now),
  };
}
