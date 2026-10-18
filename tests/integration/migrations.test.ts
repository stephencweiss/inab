import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import config from "../../drizzle.config.js";
import { migrateDatabase } from "../../src/storage/migrate.js";
import {
  applicationId,
  migrationsFolder,
  validateMigrationHistory,
} from "../../src/storage/migration-history.js";
import { backupDatabase } from "../../src/storage/backup.js";
import { accounts } from "../../src/storage/schema/accounts.js";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase, openDatabase, upgradeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";

const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
function fixture() {
  const value = temporaryDatabase();
  fixtures.push(value);
  return value;
}
afterEach(() => fixtures.splice(0).forEach((value) => value.cleanup()));

it("initializes once, preserves schema after restart, and enforces foreign keys", async () => {
  const { path } = fixture();
  await initializeDatabase(path);
  const first = openDatabase(path);
  const schema = first.sqlite.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  expect(first.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  first.sqlite.close();
  await initializeDatabase(path);
  const second = openDatabase(path);
  expect(second.sqlite.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(
    schema,
  );
  expect(validateMigrationHistory(second.sqlite, migrationsFolder).applied).toBe(2);
  expect(second.sqlite.pragma("user_version", { simple: true })).toBe(0);
  second.sqlite.close();
});
it("only init creates a missing database", () => {
  const { path } = fixture();
  expect(() => openDatabase(path)).toThrow();
  expect(existsSync(path)).toBe(false);
});
it("rejects symlink targets and leaves unrelated parent permissions alone", async () => {
  const { path, directory } = fixture();
  const before = statSync(directory).mode;
  await initializeDatabase(path);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  expect(statSync(directory).mode).toBe(before);
  const alias = join(directory, "alias.sqlite");
  symlinkSync(path, alias);
  await expect(initializeDatabase(alias)).rejects.toThrow(/symlink/i);
});
it.each(["newer", "checksum"])("rejects %s migration history", async (kind) => {
  const { path } = fixture();
  await initializeDatabase(path);
  const db = openDatabase(path);
  if (kind === "newer")
    db.sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("unknown newer migration", Date.now() + 1_000_000);
  else db.sqlite.exec("UPDATE __drizzle_migrations SET hash = 'changed'");
  db.sqlite.close();
  await expect(initializeDatabase(path)).rejects.toThrow(/history|schema|migration/i);
});

it("rolls back failed migration application schema with the pinned migrator", async () => {
  const value = fixture();
  const folder = join(value.directory, "broken-migrations");
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", when: 1, tag: "failure", breakpoints: true }],
    }),
  );
  writeFileSync(
    join(folder, "failure.sql"),
    "CREATE TABLE partial (id TEXT);\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);",
  );
  const sqlite = new Database(join(value.directory, "failure.sqlite"));
  try {
    await expect(migrateDatabase(sqlite, value.path, folder)).rejects.toThrow();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([
      { name: "__drizzle_migrations" },
    ]);
    expect(sqlite.prepare("SELECT * FROM __drizzle_migrations").all()).toEqual([]);
    expect(sqlite.pragma("user_version", { simple: true })).toBe(0);
  } finally {
    sqlite.close();
  }
});

it("upgrades a prior-version fixture after a consistent private backup", async () => {
  const value = fixture();
  const folder = join(value.directory, "prior-migrations");
  cpSync(migrationsFolder, folder, { recursive: true });
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  mkdirSync(dirname(value.path), { mode: 0o700 });
  writeFileSync(value.path, "", { mode: 0o600 });
  const sqlite = new Database(value.path);
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  sqlite.pragma(`application_id = ${applicationId}`);
  sqlite.exec(
    "INSERT INTO accounts VALUES ('prior', 'Synthetic prior cash', 'cash', 'USD', 12345, '2026-10-16', 1, '2026-10-17T00:00:00Z')",
  );
  sqlite.close();
  await upgradeDatabase(value.path);
  const backups = readdirSync(dirname(value.path)).filter((name) => name.includes(".backup-"));
  expect(backups).toHaveLength(1);
  const backupPath = join(dirname(value.path), backups[0] ?? "missing");
  expect(statSync(backupPath).mode & 0o777).toBe(0o600);
  const backup = new Database(backupPath, { readonly: true });
  expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(validateMigrationHistory(backup, migrationsFolder).applied).toBe(1);
  expect(backup.prepare("SELECT opening_cents FROM accounts").all()).toEqual([
    { opening_cents: 12345 },
  ]);
  backup.close();
  const upgraded = openDatabase(value.path);
  expect(upgraded.sqlite.prepare("SELECT opening_cents FROM accounts").all()).toEqual([
    { opening_cents: 12345 },
  ]);
  upgraded.sqlite.close();
});

it("uses immediate transactions to exclude a second writer and rolls back failed writes", async () => {
  const { path } = fixture();
  await initializeDatabase(path);
  const first = openDatabase(path);
  const second = openDatabase(path);
  second.sqlite.pragma("busy_timeout = 1");
  try {
    expect(() =>
      first.db.transaction(
        (tx) => {
          tx.insert(accounts)
            .values({
              id: "rollback",
              name: "Synthetic",
              kind: "tracking",
              currency: "USD",
              openingCents: null,
              openingDate: null,
              revision: 1,
              createdAt: "2026-10-17T00:00:00Z",
            })
            .run();
          expect(() => second.db.transaction(() => {}, { behavior: "immediate" })).toThrow(
            /locked/i,
          );
          throw new Error("forced rollback");
        },
        { behavior: "immediate" },
      ),
    ).toThrow("forced rollback");
    expect(first.db.select().from(accounts).all()).toEqual([]);
  } finally {
    first.sqlite.close();
    second.sqlite.close();
  }
});

it("rejects unrelated databases before writes", async () => {
  const value = fixture();
  const path = join(value.directory, "unrelated.sqlite");
  const sqlite = new Database(path);
  sqlite.exec(
    "CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('synthetic'); PRAGMA application_id = 123;",
  );
  sqlite.close();
  const before = readFileSync(path);
  await expect(initializeDatabase(path)).rejects.toThrow(/application ID/);
  expect(readFileSync(path)).toEqual(before);
  expect(readdirSync(value.directory)).toEqual(["unrelated.sqlite"]);
});

it("lists every schema file explicitly", () => {
  expect(config.dialect).toBe("sqlite");
  expect(config.out).toBe("./db/migrations");
  expect(
    Array.isArray(config.schema)
      ? [...config.schema].sort((left, right) => left.localeCompare(right))
      : config.schema,
  ).toEqual(
    readdirSync(new URL("../../src/storage/schema/", import.meta.url))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `./src/storage/schema/${name}`)
      .sort((left, right) => left.localeCompare(right)),
  );
});

it("enforces safe integer cents, required fields, classes, and unique keys", async () => {
  const { path } = fixture();
  await initializeDatabase(path);
  const { sqlite, db } = openDatabase(path);
  const insert = sqlite.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  try {
    for (const cents of [0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      insert.run(
        `cash-${cents}`,
        "Synthetic cash",
        "cash",
        "USD",
        cents,
        "2026-10-16",
        1,
        "2026-10-17T00:00:00Z",
      );
    }
    expect(db.select({ cents: accounts.openingCents }).from(accounts).all()).toEqual([
      { cents: 0 },
      { cents: Number.MAX_SAFE_INTEGER },
      { cents: Number.MIN_SAFE_INTEGER },
    ]);
    for (const amount of [0.5, Number.MAX_SAFE_INTEGER + 1, "invalid"]) {
      expect(() =>
        insert.run("bad-cents", "Synthetic", "cash", "USD", amount, "2026-10-16", 1, "now"),
      ).toThrow(/constraint/i);
    }
    for (const values of [
      ["blank", "  ", "cash", "USD", 0, "2026-10-16", 1, "now"],
      ["kind", "Synthetic", "other", "USD", 0, "2026-10-16", 1, "now"],
      ["currency", "Synthetic", "cash", "EUR", 0, "2026-10-16", 1, "now"],
      ["opening", "Synthetic", "cash", "USD", null, null, 1, "now"],
      ["tracking", "Synthetic", "tracking", "USD", 0, "2026-10-16", 1, "now"],
      ["revision", "Synthetic", "cash", "USD", 0, "2026-10-16", 0.5, "now"],
      ["name", null, "cash", "USD", 0, "2026-10-16", 1, "now"],
    ])
      expect(() => insert.run(...values)).toThrow(/constraint/i);
    const transaction = sqlite.prepare(
      "INSERT INTO transactions VALUES (?, ?, '2026-10-17', '2026-10-17', ?, '', '', 1, 'now', 'now')",
    );
    for (const amount of [0, 0.1, Number.MAX_SAFE_INTEGER + 1, "invalid"]) {
      expect(() => transaction.run("bad", "cash-0", amount)).toThrow(/constraint/i);
    }
    expect(() => transaction.run("missing", "missing-account", 1)).toThrow(/FOREIGN KEY/);
    const snapshot = sqlite.prepare(
      "INSERT INTO snapshots VALUES (?, ?, '2026-10-17', ?, ?, 'now', 1)",
    );
    for (const amount of [0.1, Number.MAX_SAFE_INTEGER + 1, "invalid"])
      expect(() => snapshot.run("bad", "cash-0", amount, "manual")).toThrow(/constraint/i);
    expect(() => snapshot.run("bad-source", "cash-0", 0, "provider")).toThrow(/constraint/i);
    snapshot.run("snapshot", "cash-0", 0, "manual");
    expect(() => snapshot.run("duplicate", "cash-0", 10, "manual")).toThrow(/UNIQUE/);
    expect(() => snapshot.run("fk", "missing-account", 0, "manual")).toThrow(/FOREIGN KEY/);
    const reconciliation = sqlite.prepare(
      "INSERT INTO reconciliations VALUES (?, 'cash-0', '2026-10-17', ?, ?, ?, '2026-10-16', 1, ?, 'now')",
    );
    for (let field = 0; field < 3; field++) {
      for (const amount of [0.1, Number.MAX_SAFE_INTEGER + 1, "invalid"]) {
        const amounts: (number | string)[] = [0, 0, 0];
        amounts[field] = amount;
        expect(() => reconciliation.run("bad", ...amounts, "valid")).toThrow(/constraint/i);
      }
    }
    expect(() => reconciliation.run("bad-status", 0, 0, 0, "other")).toThrow(/constraint/i);
    reconciliation.run("rec", 0, 0, 0, "valid");
    expect(() => reconciliation.run("duplicate", 0, 0, 0, "valid")).toThrow(/UNIQUE/);
  } finally {
    sqlite.close();
  }
});

it("keeps reconciliation membership in the same account after inserts and parent edits", async () => {
  const { path } = fixture();
  await initializeDatabase(path);
  const { sqlite } = openDatabase(path);
  try {
    sqlite.exec(`INSERT INTO accounts VALUES ('a', 'Synthetic A', 'cash', 'USD', 0, '2026-10-16', 1, 'now');
      INSERT INTO accounts VALUES ('b', 'Synthetic B', 'cash', 'USD', 0, '2026-10-16', 1, 'now');
      INSERT INTO transactions VALUES ('a-tx', 'a', '2026-10-17', '2026-10-17', 1, '', '', 1, 'now', 'now');
      INSERT INTO transactions VALUES ('b-tx', 'b', '2026-10-17', '2026-10-17', 1, '', '', 1, 'now', 'now');
      INSERT INTO reconciliations VALUES ('rec', 'a', '2026-10-17', 1, 1, 0, '2026-10-16', 1, 'valid', 'now');`);
    const evidence = sqlite.prepare(
      "INSERT INTO reconciliation_entries VALUES ('rec', ?, 1, ?, '2026-10-17')",
    );
    expect(() => evidence.run("b-tx", 1)).toThrow(/account mismatch/);
    for (const amount of [0, 0.1, Number.MAX_SAFE_INTEGER + 1, "invalid"])
      expect(() => evidence.run("a-tx", amount)).toThrow(/constraint/i);
    evidence.run("a-tx", 1);
    expect(() => evidence.run("a-tx", 1)).toThrow(/UNIQUE/);
    expect(() => sqlite.exec("UPDATE reconciliation_entries SET transaction_id = 'b-tx'")).toThrow(
      /account mismatch/,
    );
    expect(() => sqlite.exec("UPDATE transactions SET account_id = 'b' WHERE id = 'a-tx'")).toThrow(
      /account mismatch/,
    );
    expect(() => sqlite.exec("UPDATE reconciliations SET account_id = 'b'")).toThrow(
      /account mismatch/,
    );
    expect(() => sqlite.exec("DELETE FROM accounts WHERE id = 'a'")).toThrow(/FOREIGN KEY/);
  } finally {
    sqlite.close();
  }
});

it("creates a private journal during an immediate write", async () => {
  const { path } = fixture();
  await initializeDatabase(path);
  const { db, sqlite } = openDatabase(path);
  try {
    db.transaction(
      (tx) => {
        tx.insert(accounts)
          .values({
            id: "journal",
            name: "Synthetic",
            kind: "tracking",
            currency: "USD",
            openingCents: null,
            openingDate: null,
            revision: 1,
            createdAt: "now",
          })
          .run();
        expect(statSync(`${path}-journal`).mode & 0o777).toBe(0o600);
      },
      { behavior: "immediate" },
    );
    expect(existsSync(`${path}-journal`)).toBe(false);
  } finally {
    sqlite.close();
  }
});

it("rejects unknown ledger rows and changed migration artifacts", async () => {
  const value = fixture();
  await initializeDatabase(value.path);
  const { sqlite } = openDatabase(value.path);
  try {
    const folder = join(value.directory, "tampered");
    cpSync(migrationsFolder, folder, { recursive: true });
    appendFileSync(join(folder, "0000_manual_accounts.sql"), "\nSELECT 1;\n");
    await expect(migrateDatabase(sqlite, value.path, folder)).rejects.toThrow(/history/);
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("unknown", Date.now() + 1_000_000);
    await expect(migrateDatabase(sqlite, value.path)).rejects.toThrow(/history/);
  } finally {
    sqlite.close();
  }
});

it("stops an existing-data upgrade when consistent backup fails", async () => {
  const value = fixture();
  await initializeDatabase(value.path);
  const { sqlite } = openDatabase(value.path);
  try {
    sqlite.exec(
      "DROP TRIGGER reconciliation_entries_account_insert; DROP TRIGGER reconciliation_entries_account_update; DROP TRIGGER transactions_account_update; DROP TRIGGER reconciliations_account_update; DELETE FROM __drizzle_migrations WHERE rowid = 2;",
    );
    const before = sqlite.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
    const backup = vi
      .spyOn(sqlite, "backup")
      .mockRejectedValue(new Error("Synthetic backup failure"));
    await expect(migrateDatabase(sqlite, value.path)).rejects.toThrow("Synthetic backup failure");
    expect(sqlite.prepare("SELECT name FROM sqlite_master ORDER BY name").all()).toEqual(before);
    expect(validateMigrationHistory(sqlite, migrationsFolder).applied).toBe(1);
    expect(readdirSync(dirname(value.path)).filter((name) => name.includes(".backup-"))).toEqual(
      [],
    );
    backup.mockRestore();
  } finally {
    sqlite.close();
  }
});

it("publishes backups exclusively and removes failed temporary outputs", async () => {
  const value = fixture();
  await initializeDatabase(value.path);
  const { sqlite } = openDatabase(value.path);
  const destination = join(value.directory, "backup.sqlite");
  try {
    await backupDatabase(sqlite, destination);
    const original = readFileSync(destination);
    await expect(backupDatabase(sqlite, destination)).rejects.toThrow();
    expect(readFileSync(destination)).toEqual(original);
    expect(readdirSync(value.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
  } finally {
    sqlite.close();
  }
});

it("keeps backup output private and unpublished while SQLite is copying", async () => {
  const value = fixture();
  await initializeDatabase(value.path);
  const { sqlite } = openDatabase(value.path);
  const destination = join(value.directory, "unpublished.sqlite");
  const nativeBackup = sqlite.backup.bind(sqlite);
  const spy = vi.spyOn(sqlite, "backup").mockImplementation(async (filename, options) => {
    expect(existsSync(destination)).toBe(false);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
    return nativeBackup(filename, options);
  });
  try {
    await backupDatabase(sqlite, destination);
    expect(existsSync(destination)).toBe(true);
    expect(readdirSync(value.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
  } finally {
    spy.mockRestore();
    sqlite.close();
  }
});

it("refuses to publish an unrelated backup and cleans temporary output", async () => {
  const value = fixture();
  await initializeDatabase(value.path);
  const { sqlite } = openDatabase(value.path);
  const destination = join(value.directory, "invalid-backup.sqlite");
  const spy = vi.spyOn(sqlite, "backup").mockResolvedValue({ totalPages: 0, remainingPages: 0 });
  try {
    await expect(backupDatabase(sqlite, destination)).rejects.toThrow(/identity|version/);
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(value.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
  } finally {
    spy.mockRestore();
    sqlite.close();
  }
});

it("can reopen a committed migration after interruption at the Drizzle commit boundary", async () => {
  const value = fixture();
  mkdirSync(dirname(value.path), { mode: 0o700 });
  writeFileSync(value.path, "", { mode: 0o600 });
  const sqlite = new Database(value.path);
  sqlite.pragma(`application_id = ${applicationId}`);
  const nativePrepare = sqlite.prepare.bind(sqlite);
  let committed = false;
  const spy = vi.spyOn(sqlite, "prepare").mockImplementation((source) => {
    const statement = nativePrepare(source);
    if (source === "COMMIT") {
      const nativeRun = statement.run.bind(statement);
      vi.spyOn(statement, "run").mockImplementation((...parameters) => {
        nativeRun(...parameters);
        committed = true;
        throw new Error("Synthetic interruption after migration commit");
      });
    }
    return statement;
  });
  try {
    await expect(migrateDatabase(sqlite, value.path)).rejects.toThrow();
    expect(committed).toBe(true);
  } finally {
    spy.mockRestore();
    sqlite.close();
  }
  const reopened = openDatabase(value.path);
  expect(
    reopened.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(),
  ).toEqual({ count: 2 });
  reopened.sqlite.close();
  await expect(initializeDatabase(value.path)).resolves.toEqual({
    ok: true,
    database: value.path,
    schemaVersion: 2,
  });
});
