import Database from "better-sqlite3";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createRecovery } from "../../src/application/backup.js";
import { createRecoveryStore } from "../../src/storage/backup.js";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createReconciliations } from "../../src/application/reconcile.js";
import { createSnapshots } from "../../src/application/snapshots.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { createSnapshotStore } from "../../src/storage/snapshots.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.cleanup());
  vi.restoreAllMocks();
});
const runtime = {
  id: () => crypto.randomUUID(),
  now: () => "2026-10-17T12:00:00.000Z",
  today: () => "2026-10-17",
};
function value<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
async function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const accounts = createAccounts(createAccountStore(f.path), runtime);
  const add = (kind: "cash" | "tracking") =>
    value(
      accounts.commit(
        value(
          accounts.previewAdd(
            kind === "cash"
              ? {
                  name: "Synthetic cash",
                  kind,
                  currency: "USD",
                  openingCents: 10000,
                  openingDate: "2026-10-01",
                }
              : {
                  name: "Synthetic Tracking",
                  kind,
                  currency: "USD",
                  openingCents: null,
                  openingDate: null,
                },
          ),
        ),
      ),
    ).account;
  const cash = add("cash");
  const tracking = add("tracking");
  const tx = createTransactions(createTransactionStore(f.path), runtime);
  const input = {
    cents: -1000,
    occurredOn: "2026-10-04",
    postedOn: "2026-10-05",
    payee: "Synthetic shop",
    memo: "",
  };
  const entry = value(tx.commit(value(tx.previewAdd(cash.id, input)))).transaction;
  const checks = createReconciliations(createReconciliationStore(f.path), runtime);
  value(checks.commit(value(checks.preview(cash.id, "2026-10-10", 9000))));
  value(tx.commit(value(tx.previewEdit(entry.id, 1, { ...input, cents: -1100 }))));
  value(checks.commit(value(checks.preview(cash.id, "2026-10-10", 8900))));
  const snapshots = createSnapshots(createSnapshotStore(f.path), runtime);
  const snapshot = value(
    snapshots.commit(value(snapshots.previewAdd(tracking.id, "2026-10-16", 500000))),
  ).snapshot;
  value(snapshots.commit(value(snapshots.previewCorrect(snapshot.id, 1, 510000))));
  return { ...f, cash, tracking, entry, snapshot };
}
function records(path: string) {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return [
      "accounts",
      "transactions",
      "snapshots",
      "reconciliations",
      "reconciliation_entries",
      "changes",
      "__drizzle_migrations",
    ].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  } finally {
    sqlite.close();
  }
}
it("preserves all records, IDs, revisions, audit and ledger across backup, restore and process restart", async () => {
  const f = await setup();
  const before = records(f.path);
  const bytes = readFileSync(f.path);
  const backup = join(f.directory, "saved", "backup.sqlite");
  const restored = join(f.directory, "recovered", "plan.sqlite");
  const app = createRecovery(createRecoveryStore(), runtime.id);
  const preview = value(app.preview("backup", f.path, backup));
  expect(existsSync(dirname(backup))).toBe(false);
  expect(value(await app.commit(preview))).toMatchObject({
    source: f.path,
    destination: backup,
    schemaVersion: 2,
    migrationNeeded: false,
    operationId: preview.operationId,
  });
  const backupBytes = readFileSync(backup);
  value(await app.commit(value(app.preview("restore", backup, restored))));
  expect(records(backup)).toEqual(before);
  expect(records(restored)).toEqual(before);
  expect(readFileSync(f.path)).toEqual(bytes);
  expect(readFileSync(backup)).toEqual(backupBytes);
  for (const path of [backup, restored]) {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  }
  const register = runCli(["--db", restored, "register", f.cash.id, "--json"], f.directory);
  expect(register.status).toBe(0);
  expect(register.stdout).toContain('"clearedCents":8900');
  expect(register.stdout).toContain(f.entry.id);
  expect(register.stdout).toContain('"revision":2');
  const checks = runCli(
    ["--db", restored, "reconciliation", "list", "--account", f.cash.id, "--json"],
    f.directory,
  );
  expect(checks.status).toBe(0);
  expect(checks.stdout).toContain('"needs-review"');
  expect(checks.stdout).toContain('"valid"');
  const snapshots = runCli(
    ["--db", restored, "snapshot", "list", "--account", f.tracking.id, "--json"],
    f.directory,
  );
  expect(snapshots.status).toBe(0);
  expect(snapshots.stdout).toContain(f.snapshot.id);
  expect(snapshots.stdout).toContain('"balanceCents":510000');
  expect(snapshots.stdout).toContain('"revision":2');
  expect(records(restored)).toEqual(before);
});
it.each(["backup", "restore"] as const)(
  "refuses unsafe %s endpoints without changing any source or target",
  async (operation) => {
    const f = await setup();
    const app = createRecovery(createRecoveryStore(), runtime.id);
    const bytes = readFileSync(f.path);
    const existing = join(f.directory, "existing");
    writeFileSync(existing, "Synthetic unrelated sentinel");
    const directory = join(f.directory, "directory");
    mkdirSync(directory);
    const alias = join(f.directory, "alias");
    symlinkSync(f.path, alias);
    const dangling = join(f.directory, "dangling");
    symlinkSync(join(f.directory, "missing"), dangling);
    const hardlink = join(f.directory, "hardlink");
    linkSync(f.path, hardlink);
    for (const destination of [
      f.path,
      existing,
      directory,
      alias,
      dangling,
      hardlink,
      `${f.path}/../plan.sqlite`,
    ])
      expect(app.preview(operation, f.path, destination).ok).toBe(false);
    expect(app.preview(operation, alias, join(f.directory, "new")).ok).toBe(false);
    expect(
      app.preview(operation, join(f.directory, "typo"), join(f.directory, "new")),
    ).toMatchObject({ ok: false, reason: "missing-source" });
    expect(existsSync(join(f.directory, "typo"))).toBe(false);
    expect(readFileSync(f.path)).toEqual(bytes);
    expect(readFileSync(existing, "utf8")).toBe("Synthetic unrelated sentinel");
  },
);
it.each(["corrupt", "unrelated", "newer", "changed", "older", "foreign-key"])(
  "rejects %s sources without upgrading or changing them",
  async (kind) => {
    const f = await setup();
    const path = join(f.directory, "invalid.sqlite");
    cpSync(f.path, path);
    if (kind === "corrupt") writeFileSync(path, "Synthetic corrupt file");
    else {
      const sqlite = new Database(path);
      if (kind === "unrelated") sqlite.pragma("application_id = 123");
      if (kind === "newer")
        sqlite.exec("INSERT INTO __drizzle_migrations VALUES (3, 'future', 9999999999999)");
      if (kind === "changed") sqlite.exec("UPDATE __drizzle_migrations SET hash = 'changed'");
      if (kind === "older") sqlite.exec("DELETE FROM __drizzle_migrations WHERE rowid = 2");
      if (kind === "foreign-key")
        sqlite.exec("PRAGMA foreign_keys = OFF; UPDATE snapshots SET account_id = 'missing'");
      sqlite.close();
    }
    const before = readFileSync(path);
    const app = createRecovery(createRecoveryStore(), runtime.id);
    (["backup", "restore"] as const).forEach((operation) => {
      const result = app.preview(operation, path, join(f.directory, "new"));
      expect(result.ok).toBe(false);
      if (kind === "newer")
        expect(result).toMatchObject({
          reason: "schema-version",
          schemaVersion: 3,
          requiredSchemaVersion: 2,
        });
      if (kind === "older")
        expect(result).toMatchObject({
          reason: "schema-version",
          schemaVersion: 1,
          requiredSchemaVersion: 2,
        });
    });
    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(join(f.directory, "new"))).toBe(false);
  },
);
it.each(["backup", "restore"] as const)(
  "cleans private temporary %s output on interruption and preserves a racing target",
  async (operation) => {
    const f = await setup();
    const source = readFileSync(f.path);
    const destination = join(f.directory, "result.sqlite");
    for (const race of [false, true]) {
      const app = createRecovery(
        createRecoveryStore({
          beforePublish: (temporary) => {
            expect(statSync(temporary).mode & 0o777).toBe(0o600);
            expect(existsSync(destination)).toBe(false);
            if (race) writeFileSync(destination, "Synthetic racing sentinel");
            else throw new Error("Synthetic interrupted publication");
          },
        }),
        runtime.id,
      );
      const p = value(app.preview(operation, f.path, destination));
      if (race) expect((await app.commit(p)).ok).toBe(false);
      else await expect(app.commit(p)).rejects.toThrow(p.operationId);
      expect(readFileSync(f.path)).toEqual(source);
      expect(readdirSync(f.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
      if (race) expect(readFileSync(destination, "utf8")).toBe("Synthetic racing sentinel");
      else expect(existsSync(destination)).toBe(false);
    }
  },
);
it("revalidates endpoints and rejects stale sidecars before output creation", async () => {
  const f = await setup();
  const destination = join(f.directory, "new.sqlite");
  const app = createRecovery(createRecoveryStore(), runtime.id);
  const p = value(app.preview("restore", f.path, destination));
  writeFileSync(`${destination}-wal`, "Synthetic stale sidecar");
  expect((await app.commit(p)).ok).toBe(false);
  expect(existsSync(destination)).toBe(false);
  expect(readFileSync(`${destination}-wal`, "utf8")).toBe("Synthetic stale sidecar");
  const c = openDatabase(f.path);
  c.sqlite.close();
});
it.each(["backup", "restore"] as const)(
  "removes only its temporary output when the %s copy fails",
  async (operation) => {
    const f = await setup();
    const before = readFileSync(f.path);
    const destination = join(f.directory, "failed", "result.sqlite");
    const app = createRecovery(createRecoveryStore(), runtime.id);
    const preview = value(app.preview(operation, f.path, destination));
    vi.spyOn(Database.prototype, "backup").mockImplementation(async (temporary) => {
      expect(statSync(temporary).mode & 0o777).toBe(0o600);
      writeFileSync(
        join(dirname(temporary), "unrelated-sentinel"),
        "Synthetic unrelated concurrent file",
      );
      throw new Error("Synthetic SQLite copy failure");
    });
    await expect(app.commit(preview)).rejects.toThrow(preview.operationId);
    expect(readFileSync(f.path)).toEqual(before);
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(dirname(destination))).toEqual(["unrelated-sentinel"]);
  },
);
it("refuses a symlink source or destination created after preview without touching the links", async () => {
  const f = await setup();
  const app = createRecovery(createRecoveryStore(), runtime.id);
  const destination = join(f.directory, "late-link");
  const before = readFileSync(f.path);
  const preview = value(app.preview("restore", f.path, destination));
  symlinkSync(join(f.directory, "absent"), destination);
  expect((await app.commit(preview)).ok).toBe(false);
  expect(existsSync(join(f.directory, "absent"))).toBe(false);
  expect(readFileSync(f.path)).toEqual(before);
});
it("refuses a replaced source symlink even when it resolves to the same original file", async () => {
  const f = await setup();
  const bytes = readFileSync(f.path);
  const saved = join(f.directory, "original.sqlite");
  const destination = join(f.directory, "new.sqlite");
  const app = createRecovery(
    createRecoveryStore({
      beforePublish: () => {
        renameSync(f.path, saved);
        symlinkSync(saved, f.path);
      },
    }),
    runtime.id,
  );
  expect((await app.commit(value(app.preview("backup", f.path, destination)))).ok).toBe(false);
  expect(readFileSync(saved)).toEqual(bytes);
  expect(existsSync(destination)).toBe(false);
  expect(readdirSync(f.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
});
it("revalidates the private copy after the publication hook before exposing it", async () => {
  const f = await setup();
  const destination = join(f.directory, "invalid-copy.sqlite");
  const app = createRecovery(
    createRecoveryStore({
      beforePublish: (temporary) => {
        const sqlite = new Database(temporary);
        sqlite.pragma("application_id = 123");
        sqlite.close();
      },
    }),
    runtime.id,
  );
  expect((await app.commit(value(app.preview("restore", f.path, destination)))).ok).toBe(false);
  expect(existsSync(destination)).toBe(false);
  expect(readdirSync(f.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
});
it("reads committed WAL data through SQLite without changing the source journal mode", async () => {
  const f = await setup();
  const sqlite = new Database(f.path);
  const destination = join(f.directory, "wal-backup.sqlite");
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite
      .prepare("UPDATE accounts SET name = ? WHERE id = ?")
      .run("Synthetic latest WAL", f.cash.id);
    const expected = records(f.path);
    const source = readFileSync(f.path);
    const wal = readFileSync(`${f.path}-wal`);
    const app = createRecovery(createRecoveryStore(), runtime.id);
    value(await app.commit(value(app.preview("backup", f.path, destination))));
    expect(records(destination)).toEqual(expected);
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(readFileSync(f.path)).toEqual(source);
    expect(readFileSync(`${f.path}-wal`)).toEqual(wal);
  } finally {
    sqlite.close();
  }
});
it("classifies invalid paths before opening a database or creating output", async () => {
  const f = await setup();
  const app = createRecovery(createRecoveryStore(), runtime.id);
  for (const destination of ["", ":memory:", "bad\0path", join(f.path, "child.sqlite")])
    expect(app.preview("backup", f.path, destination)).toMatchObject({
      ok: false,
      reason: "invalid-path",
    });
});
it.each(["backup", "restore"] as const)(
  "rejects a valid source replaced after the %s preview before confirmation",
  async (operation) => {
    const f = await setup();
    const originalBytes = readFileSync(f.path);
    const saved = join(f.directory, "original.sqlite");
    const destination = join(f.directory, "uncreated", "new.sqlite");
    const app = createRecovery(createRecoveryStore(), runtime.id);
    const preview = value(app.preview(operation, f.path, destination));
    renameSync(f.path, saved);
    await initializeDatabase(f.path);
    const replacementBytes = readFileSync(f.path);
    expect(await app.commit(preview)).toMatchObject({ ok: false, reason: "invalid-path" });
    expect(readFileSync(saved)).toEqual(originalBytes);
    expect(readFileSync(f.path)).toEqual(replacementBytes);
    expect(existsSync(dirname(destination))).toBe(false);
    expect(readdirSync(f.directory).filter((name) => name.includes(".tmp-"))).toEqual([]);
  },
);
it("permits committed changes within the previewed source file and keeps its identity internal", async () => {
  const f = await setup();
  const destination = join(f.directory, "current.sqlite");
  const app = createRecovery(createRecoveryStore(), runtime.id);
  const preview = value(app.preview("backup", f.path, destination));
  const sqlite = new Database(f.path);
  sqlite
    .prepare("UPDATE accounts SET name = ? WHERE id = ?")
    .run("Synthetic new committed name", f.cash.id);
  sqlite.close();
  const expected = records(f.path);
  const result = value(await app.commit(preview));
  expect(records(destination)).toEqual(expected);
  expect(result).not.toHaveProperty("sourceIdentity");
});
it("reports recorded ledger count and supported schema for changed history without validating its schema", async () => {
  const f = await setup();
  const sqlite = new Database(f.path);
  sqlite.exec("UPDATE __drizzle_migrations SET hash = 'changed'");
  sqlite.close();
  const before = readFileSync(f.path);
  const app = createRecovery(createRecoveryStore(), runtime.id);
  const result = app.preview("restore", f.path, join(f.directory, "new.sqlite"));
  expect(result).toMatchObject({ ok: false, reason: "invalid-backup" });
  if (result.ok) throw new Error("Expected refusal");
  expect(result.message).toContain("recorded ledger count 2");
  expect(result.message).toContain("supports schema version 2");
  expect(readFileSync(f.path)).toEqual(before);
});
