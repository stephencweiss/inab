import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupDatabase } from "./backup.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";

/** Caller must validate the target identity before opening a writable connection. */
export async function migrateDatabase(
  sqlite: Database.Database,
  path: string,
  folder = migrationsFolder,
) {
  const history = validateMigrationHistory(sqlite, folder);
  if (history.applied === history.latest) return history.latest;
  if (history.applied > 0) await backupDatabase(sqlite, `${path}.backup-${randomUUID()}.sqlite`);
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  return history.latest;
}
