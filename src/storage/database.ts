import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applicationId, migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { migrateDatabase } from "./migrate.js";

export function validateDatabasePath(path: string) {
  if (!path.trim() || path === ":memory:") throw new Error("An explicit database path is required");
  const target = resolve(path);
  let targetStat;
  try {
    targetStat = lstatSync(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (targetStat?.isSymbolicLink()) throw new Error("Symlink database targets are not allowed");
  if (targetStat && !targetStat.isFile()) throw new Error("Database target must be a regular file");
  return target;
}

function validateIdentity(sqlite: Database.Database, allowEmpty: boolean) {
  const identity = sqlite.pragma("application_id", { simple: true });
  if (identity === applicationId) return;
  const schema = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .all();
  if (allowEmpty && identity === 0 && schema.length === 0) return;
  throw new Error("Unrelated database application ID");
}

function connect(path: string, allowEmpty: boolean) {
  const probe = new Database(path, { readonly: true, fileMustExist: true });
  try {
    validateIdentity(probe, allowEmpty);
    validateMigrationHistory(probe, migrationsFolder);
  } finally {
    probe.close();
  }
  const sqlite = new Database(path, { fileMustExist: true, timeout: 1000 });
  try {
    sqlite.pragma("foreign_keys = ON");
    if (sqlite.pragma("foreign_keys", { simple: true }) !== 1)
      throw new Error("Foreign keys unavailable");
    sqlite.pragma("busy_timeout = 1000");
    if (sqlite.pragma("journal_mode = DELETE", { simple: true }) !== "delete")
      throw new Error("Rollback journal unavailable");
    return { sqlite, db: drizzle(sqlite) };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export function openDatabase(path: string) {
  return connect(validateDatabasePath(path), false);
}

/** Init can create an empty target. Existing targets are checked before writes. */
export async function initializeDatabase(path: string) {
  const target = validateDatabasePath(path);
  const fresh = !existsSync(target);
  if (fresh) {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const reservation = openSync(target, "wx", 0o600);
    closeSync(reservation);
  }
  const connection = connect(target, fresh);
  try {
    if (fresh) connection.sqlite.pragma(`application_id = ${applicationId}`);
    const schemaVersion = await migrateDatabase(connection.sqlite, target);
    return { ok: true, database: realpathSync(target), schemaVersion };
  } finally {
    connection.sqlite.close();
  }
}

export async function upgradeDatabase(path: string) {
  const target = validateDatabasePath(path);
  const connection = openDatabase(target);
  try {
    const schemaVersion = await migrateDatabase(connection.sqlite, target);
    return { ok: true, database: target, schemaVersion };
  } finally {
    connection.sqlite.close();
  }
}
