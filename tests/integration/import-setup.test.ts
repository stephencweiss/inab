import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applicationId, migrationsFolder } from "../../src/storage/migration-history.js";
import { afterEach, expect, it } from "vitest";
import { initializeDatabase, openDatabase, upgradeDatabase } from "../../src/storage/database.js";
import { readSetup, chooseFresh, assertEmptySetup } from "../../src/storage/setup.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function target() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  return f.path;
}
it("initializes distinct open targets and reads do not close setup", async () => {
  const a = await target();
  const b = await target();
  expect(readSetup(a)).toMatchObject({
    state: "open",
    revision: 1,
    completedAt: null,
    importId: null,
  });
  expect(readSetup(a).targetId).not.toBe(readSetup(b).targetId);
  const c = openDatabase(a);
  try {
    expect(assertEmptySetup(c.db)).toBe(true);
  } finally {
    c.sqlite.close();
  }
  expect(readSetup(a).state).toBe("open");
});
it("fresh confirmation closes empty setup and rejects stale or repeated changes", async () => {
  const path = await target();
  expect(chooseFresh(path, 2, "2026-10-22T12:00:00Z")).toEqual({
    ok: false,
    reason: "stale-version",
  });
  expect(chooseFresh(path, 1, "2026-10-22T12:00:00Z")).toMatchObject({
    ok: true,
    value: { state: "fresh", revision: 2 },
  });
  expect(chooseFresh(path, 2, "2026-10-22T12:00:00Z")).toEqual({
    ok: false,
    reason: "setup-closed",
  });
});
it("first manual account and fresh setup commit atomically", async () => {
  const path = await target();
  const app = createAccounts(createAccountStore(path), {
    id: () => crypto.randomUUID(),
    now: () => "2026-10-22T12:00:00Z",
    today: () => "2026-10-22",
  });
  const p = app.previewAdd({
    name: "Synthetic",
    kind: "tracking",
    currency: "USD",
    openingCents: null,
    openingDate: null,
  });
  if (!p.ok) throw new Error("preview");
  expect(readSetup(path).state).toBe("open");
  expect(app.commit(p.value).ok).toBe(true);
  expect(readSetup(path)).toMatchObject({ state: "fresh", revision: 2 });
});

it("rolls back automatic fresh completion when account persistence fails", async () => {
  const path = await target();
  const c = openDatabase(path);
  c.sqlite.exec(
    "CREATE TRIGGER synthetic_failure BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END",
  );
  c.sqlite.close();
  const app = createAccounts(createAccountStore(path), {
    id: () => crypto.randomUUID(),
    now: () => "2026-10-22T12:00:00Z",
    today: () => "2026-10-22",
  });
  const p = app.previewAdd({
    name: "Synthetic",
    kind: "tracking",
    currency: "USD",
    openingCents: null,
    openingDate: null,
  });
  if (!p.ok) throw new Error("preview");
  expect(() => app.commit(p.value)).toThrow("Synthetic failure");
  expect(readSetup(path)).toMatchObject({ state: "open", revision: 1 });
});
it("includes future household tables and missing setup fails closed", async () => {
  const path = await target();
  const c = openDatabase(path);
  try {
    c.sqlite.exec(
      "CREATE TABLE future_household (id TEXT); INSERT INTO future_household VALUES ('synthetic')",
    );
    expect(() => assertEmptySetup(c.db)).toThrow("setup-not-empty");
    c.sqlite.exec("DELETE FROM setup");
    expect(() => assertEmptySetup(c.db)).toThrow("Setup metadata missing");
  } finally {
    c.sqlite.close();
  }
});
it("enforces singleton and complete setup states", async () => {
  const path = await target();
  const c = openDatabase(path);
  try {
    expect(() =>
      c.sqlite.exec("INSERT INTO setup VALUES (2,'another',1,'open',NULL,NULL)"),
    ).toThrow();
    expect(() =>
      c.sqlite.exec("UPDATE setup SET state='ynab',completed_at='today' WHERE singleton=1"),
    ).toThrow();
    expect(() => c.sqlite.exec("UPDATE setup SET state='invalid' WHERE singleton=1")).toThrow();
  } finally {
    c.sqlite.close();
  }
});

it.each([false, true])(
  "upgrades a legacy target with household data=%s without changing existing rows",
  async (populated) => {
    const f = temporaryDatabase();
    fixtures.push(f);
    mkdirSync(dirname(f.path), { recursive: true });
    const folder = join(f.directory, "prior");
    mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(join(migrationsFolder, entry.tag + ".sql"), join(folder, entry.tag + ".sql"));
    const sqlite = new Database(f.path);
    sqlite.pragma(`application_id = ${applicationId}`);
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    if (populated)
      sqlite
        .prepare("INSERT INTO changes VALUES (?,?,?,?,?,?)")
        .run("legacy-change", "account.add", "deleted-account", null, "{}", "2026-10-17");
    sqlite.close();
    await upgradeDatabase(f.path);
    expect(readSetup(f.path).state).toBe(populated ? "fresh" : "open");
    const c = openDatabase(f.path);
    try {
      expect(c.sqlite.prepare("SELECT count(*) AS n FROM changes").get()).toEqual({
        n: populated ? 1 : 0,
      });
      expect(c.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      c.sqlite.close();
    }
  },
);
