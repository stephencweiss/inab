import { randomUUID } from "node:crypto";
import { closeSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve, basename, join } from "node:path";
import Database from "better-sqlite3";
import type {
  RecoveryInspection,
  RecoveryResult,
  RecoverySourceIdentity,
  RecoveryStore,
} from "../application/ports.js";
import {
  applicationId,
  MigrationHistoryError,
  migrationsFolder,
  validateMigrationHistory,
} from "./migration-history.js";

type CopyOptions = { beforePublish: ((temporary: string) => void) | null };
class RecoveryInputError extends Error {
  constructor(readonly result: Exclude<RecoveryResult<never>, { ok: true }>) {
    super(result.message);
  }
}
function invalidPath(message: string): never {
  throw new RecoveryInputError({ ok: false, reason: "invalid-path", message });
}
function pathStat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOTDIR" || error.code === "ENAMETOOLONG")
    )
      invalidPath("Invalid file path or parent directory");
    throw error;
  }
}
function explicitPath(path: string) {
  if (!path.trim() || path === ":memory:" || path.includes("\0"))
    invalidPath("An explicit file path is required");
  return resolve(path);
}
function sourcePath(path: string) {
  const target = explicitPath(path);
  const stat = pathStat(target);
  if (stat === null)
    throw new RecoveryInputError({
      ok: false,
      reason: "missing-source",
      message: `Source does not exist: ${target}`,
    });
  if (stat.isSymbolicLink() || !stat.isFile())
    invalidPath("Source must be a regular file; symlink endpoints are not allowed");
  return realpathSync(target);
}
function readSourceIdentity(source: string): RecoverySourceIdentity {
  const stat = lstatSync(sourcePath(source));
  if (stat.isSymbolicLink() || !stat.isFile()) invalidPath("Source must remain a regular file");
  return { device: stat.dev, inode: stat.ino };
}
function sameSourceIdentity(left: RecoverySourceIdentity, right: RecoverySourceIdentity) {
  return left.device === right.device && left.inode === right.inode;
}
function requireSourceIdentity(source: string, expected: RecoverySourceIdentity) {
  if (!sameSourceIdentity(readSourceIdentity(source), expected))
    invalidPath("Source changed after recovery preview");
}
function destinationPath(path: string) {
  const target = explicitPath(path);
  if (pathStat(target) !== null) invalidPath(`Destination already exists: ${target}`);
  for (const suffix of ["-wal", "-shm", "-journal"])
    if (pathStat(`${target}${suffix}`) !== null)
      invalidPath(`Destination has an existing SQLite sidecar: ${target}${suffix}`);
  let parent = dirname(target);
  const missing: string[] = [];
  while (pathStat(parent) === null) {
    missing.unshift(basename(parent));
    parent = dirname(parent);
  }
  if (!lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink())
    invalidPath("Destination parent must be a directory");
  const realParent = realpathSync(parent);
  if (!lstatSync(realParent).isDirectory()) invalidPath("Destination parent must be a directory");
  return join(realParent, ...missing, basename(target));
}
function validateDatabase(sqlite: Database.Database, currentOnly: boolean) {
  if (sqlite.pragma("application_id", { simple: true }) !== applicationId)
    throw new Error("Unrelated database application ID");
  const history = validateMigrationHistory(sqlite, migrationsFolder);
  if (currentOnly && history.applied !== history.latest)
    throw new RecoveryInputError({
      ok: false,
      reason: "schema-version",
      message: `Schema version ${history.applied}; this app requires schema version ${history.latest}. Recovery requires the current schema; no migration was applied.`,
      schemaVersion: history.applied,
      requiredSchemaVersion: history.latest,
    });
  if (sqlite.pragma("integrity_check", { simple: true }) !== "ok")
    throw new Error("Database integrity check failed");
  if (sqlite.prepare("PRAGMA foreign_key_check").all().length !== 0)
    throw new Error("Database foreign key check failed");
  return history.applied;
}
function validateSource(sqlite: Database.Database) {
  try {
    return validateDatabase(sqlite, true);
  } catch (error) {
    if (error instanceof RecoveryInputError) throw error;
    if (error instanceof MigrationHistoryError && error.applied > error.latest)
      throw new RecoveryInputError({
        ok: false,
        reason: "schema-version",
        schemaVersion: error.applied,
        requiredSchemaVersion: error.latest,
        message: `Unknown newer migration history: recorded ledger count ${error.applied}; this app supports schema version ${error.latest}. Use an app that supports the backup schema. No migration was applied.`,
      });
    let message = error instanceof Error ? error.message : "Invalid backup";
    if (error instanceof MigrationHistoryError)
      message = `${error.message}: recorded ledger count ${error.applied}; this app supports schema version ${error.latest}. The recorded history is not a validated schema. No migration was applied.`;
    throw new RecoveryInputError({ ok: false, reason: "invalid-backup", message });
  }
}
function inspectPaths(source: string, destination: string): RecoveryResult<RecoveryInspection> {
  try {
    const input = sourcePath(source);
    const output = destinationPath(destination);
    if (input === output) invalidPath("Source and destination must differ");
    const sourceIdentity = readSourceIdentity(input);
    const sqlite = new Database(input, { readonly: true, fileMustExist: true });
    try {
      const schemaVersion = validateSource(sqlite);
      requireSourceIdentity(input, sourceIdentity);
      return {
        ok: true,
        value: {
          source: input,
          destination: output,
          schemaVersion,
          sourceIdentity,
          migrationNeeded: false,
        },
      };
    } finally {
      sqlite.close();
    }
  } catch (error) {
    if (error instanceof RecoveryInputError) return error.result;
    throw error;
  }
}

/** Uses an online SQLite copy and exclusive publication. Known older ledgers remain valid for migration backups. */
export async function backupDatabase(
  sqlite: Database.Database,
  destination: string,
  options: CopyOptions = { beforePublish: null },
) {
  const identity = sqlite.pragma("application_id", { simple: true });
  const version = validateMigrationHistory(sqlite, migrationsFolder).applied;
  const target = destinationPath(destination);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${randomUUID()}`;
  const reservation = openSync(temporary, "wx", 0o600);
  closeSync(reservation);
  try {
    await sqlite.backup(temporary);
    const backup = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (
        backup.pragma("application_id", { simple: true }) !== identity ||
        validateMigrationHistory(backup, migrationsFolder).applied !== version
      )
        throw new Error("Backup identity or schema version mismatch");
      if (backup.pragma("integrity_check", { simple: true }) !== "ok")
        throw new Error("Backup integrity check failed");
      if (backup.prepare("PRAGMA foreign_key_check").all().length !== 0)
        throw new Error("Backup foreign key check failed");
    } finally {
      backup.close();
    }
    options.beforePublish?.(temporary);
    destinationPath(target);
    linkSync(temporary, target);
    return target;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Public recovery accepts only the current validated Drizzle ledger and opens sources read-only. */
export function createRecoveryStore(options: CopyOptions = { beforePublish: null }): RecoveryStore {
  return {
    inspect: inspectPaths,
    copy: async (preview) => {
      const inspected = inspectPaths(preview.source, preview.destination);
      if (!inspected.ok) return inspected;
      if (!sameSourceIdentity(inspected.value.sourceIdentity, preview.sourceIdentity))
        return {
          ok: false,
          reason: "invalid-path",
          message: "Source changed after recovery preview",
        };
      const { source, destination, schemaVersion, migrationNeeded } = inspected.value;
      const sqlite = new Database(source, { readonly: true, fileMustExist: true });
      try {
        requireSourceIdentity(source, preview.sourceIdentity);
        validateSource(sqlite);
        await backupDatabase(sqlite, destination, {
          beforePublish: (temporary) => {
            options.beforePublish?.(temporary);
            sourcePath(temporary);
            const copy = new Database(temporary, { readonly: true, fileMustExist: true });
            try {
              validateSource(copy);
            } finally {
              copy.close();
            }
            requireSourceIdentity(source, preview.sourceIdentity);
            destinationPath(destination);
          },
        });
        return { ok: true, value: { source, destination, schemaVersion, migrationNeeded } };
      } catch (error) {
        if (error instanceof RecoveryInputError) return error.result;
        throw error;
      } finally {
        sqlite.close();
      }
    },
  };
}
