import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { temporaryDatabase } from "../helpers/database.js";
import {
  applicationId,
  migrationsFolder,
  validateMigrationHistory,
} from "../../src/storage/migration-history.js";
import { openDatabase, upgradeDatabase } from "../../src/storage/database.js";
import { currentSchemaVersion } from "../helpers/schema-version.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("upgrades the exact Slice 2 schema with a recoverable backup and unchanged household history", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  const prefix = join(f.directory, "version4");
  mkdirSync(join(prefix, "meta"), { recursive: true });
  mkdirSync(dirname(f.path), { recursive: true });
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.slice(0, 4);
  writeFileSync(join(prefix, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries)
    cpSync(join(migrationsFolder, `${entry.tag}.sql`), join(prefix, `${entry.tag}.sql`));
  const sqlite = new Database(f.path);
  sqlite.pragma(`application_id = ${applicationId}`);
  migrate(drizzle(sqlite), { migrationsFolder: prefix });
  sqlite.exec(
    "INSERT INTO accounts (id,name,kind,currency,opening_cents,opening_date,revision,created_at) VALUES ('cash','Synthetic cash','cash','USD',100000,'2026-09-30',1,'2026-10-01T00:00:00.000Z')",
  );
  sqlite.exec(
    "UPDATE setup SET state='fresh',revision=revision+1,completed_at='2026-10-01T00:00:00.000Z' WHERE singleton=1",
  );
  sqlite.exec(
    "INSERT INTO changes (id,operation,entity_id,before_json,after_json,recorded_at) VALUES ('audit','account.add','cash',NULL,'{}','2026-10-01T00:00:00.000Z')",
  );
  const before = sqlite.prepare("SELECT * FROM accounts").all(),
    audit = sqlite.prepare("SELECT * FROM changes").all();
  sqlite.close();
  expect((await upgradeDatabase(f.path)).schemaVersion).toBe(currentSchemaVersion);
  const upgraded = openDatabase(f.path);
  try {
    expect(upgraded.sqlite.prepare("SELECT * FROM accounts").all()).toEqual(before);
    expect(upgraded.sqlite.prepare("SELECT * FROM changes").all()).toEqual(audit);
    expect(upgraded.sqlite.prepare("SELECT count(*) AS count FROM budget_state").get()).toEqual({
      count: 0,
    });
  } finally {
    upgraded.sqlite.close();
  }
  const backupName = readdirSync(dirname(f.path)).find((name) => name.includes(".backup-"));
  expect(backupName).toBeDefined();
  const backup = new Database(join(dirname(f.path), backupName!), { readonly: true });
  try {
    expect(validateMigrationHistory(backup, migrationsFolder).applied).toBe(4);
    expect(backup.prepare("SELECT * FROM accounts").all()).toEqual(before);
  } finally {
    backup.close();
  }
});
