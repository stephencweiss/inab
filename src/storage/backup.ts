import { randomUUID } from "node:crypto";
import { closeSync, linkSync, openSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";

/** Reserves a new private file and uses SQLite's consistent online backup. */
export async function backupDatabase(sqlite: Database.Database, destination: string) {
  const identity = sqlite.pragma("application_id", { simple: true });
  const version = validateMigrationHistory(sqlite, migrationsFolder).applied;
  const temporary = `${destination}.tmp-${randomUUID()}`;
  const reservation = openSync(temporary, "wx", 0o600);
  closeSync(reservation);
  try {
    await sqlite.backup(temporary);
    const backup = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (
        backup.pragma("application_id", { simple: true }) !== identity ||
        validateMigrationHistory(backup, migrationsFolder).applied !== version
      ) {
        throw new Error("Backup identity or schema version mismatch");
      }
      if (backup.pragma("integrity_check", { simple: true }) !== "ok") {
        throw new Error("Backup integrity check failed");
      }
      if (backup.prepare("PRAGMA foreign_key_check").all().length !== 0) {
        throw new Error("Backup foreign key check failed");
      }
    } finally {
      backup.close();
    }
    linkSync(temporary, destination);
    return destination;
  } finally {
    rmSync(temporary, { force: true });
  }
}
