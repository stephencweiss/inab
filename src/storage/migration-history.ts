import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { parseMigrationRow } from "./rows.js";

export const applicationId = 0x494e4142;
const migrationPath = import.meta.url.endsWith(".ts") ? "../../db/migrations" : "../db/migrations";
export const migrationsFolder = fileURLToPath(new URL(migrationPath, import.meta.url));

export function validateMigrationHistory(sqlite: Database.Database, folder: string) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const hasLedger = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  const rows = hasLedger
    ? sqlite
        .prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY rowid")
        .safeIntegers()
        .all()
        .map(parseMigrationRow)
    : [];
  if (rows.length > migrations.length) throw new Error("Unknown newer migration history");
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (!expected || row.hash !== expected.hash || row.createdAt !== expected.folderMillis) {
      throw new Error("Changed or unknown migration history");
    }
  }
  return { applied: rows.length, latest: migrations.length };
}
