import Database from "better-sqlite3";
import { checkTrackingHistory } from "../../src/accounts/imports/observations.js";
import { createImportHistoryStore } from "../../src/storage/import-history.js";
import { afterEach, expect, it, vi } from "vitest";
import { writeFileSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { createImportStore, parseImportReceipt } from "../../src/storage/imports.js";
import { readSetup } from "../../src/storage/setup.js";
import { readSources } from "../../src/adapters/ynab/files.js";
import { registerHeaders, planHeaders } from "../../src/adapters/ynab/csv.js";
import { deriveReview } from "../../src/accounts/imports/review.js";
import type { ReviewEnvelope, ReviewDecision } from "../../src/accounts/imports/types.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const r = join(f.directory, "register.csv"),
    p = join(f.directory, "plan.csv");
  writeFileSync(
    r,
    registerHeaders.join(",") +
      "\nSynthetic,,10/20/2026,Shop,Food,Food,Groceries,,10.00,0.00,Cleared\nSynthetic,,10/20/2026,Shop,Food,Food,Groceries,,10.00,0.00,Cleared\n",
  );
  writeFileSync(
    p,
    planHeaders.join(",") + "\nOct 2026,Food/Groceries,Food,Groceries,100.00,-20.00,80.00\n",
  );
  const sources = readSources(r, p),
    store = createImportStore(f.path);
  const decisions: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local",
      name: "Synthetic",
      kind: "cash",
      closed: false,
    },
    { tag: "opening", accountKey: "account:1", date: "2026-10-19", cents: 10000 },
    ...sources.register.rows.map((row) => ({
      tag: "row" as const,
      key: row.key,
      accountKey: "account:1",
      treatment: "posted" as const,
      postedOn: "2026-10-20",
      payee: null,
      role: "transaction" as const,
    })),
  ];
  const review: ReviewEnvelope = {
    version: 1,
    reviewId: "review",
    revision: 1,
    createdAt: "2026-10-22T12:00:00Z",
    updatedAt: "2026-10-22T12:00:00Z",
    target: store.target(),
    sources: {
      register: {
        path: r,
        sha256: sources.register.sha256,
        byteLength: sources.register.bytes.byteLength,
      },
      plan: { path: p, sha256: sources.plan.sha256, byteLength: sources.plan.bytes.byteLength },
    },
    decisions,
  };
  const derived = deriveReview(sources, decisions, "2026-10-22");
  expect(derived.ready).toBe(true);
  return { ...f, sources, store, review, derived };
}
it("commits all history and separate identical live entries once", async () => {
  const f = await setup();
  const result = await f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z");
  expect(result).toMatchObject({
    importId: "review",
    reused: false,
    report: { sourceRows: 3, liveLinked: 2, historyOnly: 1 },
  });
  expect(readSetup(f.path)).toMatchObject({ state: "ynab", importId: "review", revision: 2 });
  const c = openDatabase(f.path);
  try {
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM transactions").get()).toEqual({ n: 2 });
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM import_register_rows").get()).toEqual({
      n: 2,
    });
  } finally {
    c.sqlite.close();
  }
  expect(readSetup(result.backupPath)).toMatchObject({
    state: "open",
    revision: 1,
    importId: null,
  });
  const backup = openDatabase(result.backupPath);
  try {
    expect(backup.sqlite.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual({ n: 0 });
  } finally {
    backup.sqlite.close();
  }
  expect(f.store.receipt(f.review)).toEqual({ ...result, reused: true });
  expect(await f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T13:00:00Z")).toEqual({
    ...result,
    reused: true,
  });
  expect(() => f.store.receipt({ ...f.review, revision: 2 })).toThrow("setup-closed");
});
it.each(["sources", "accounts", "history", "live", "observations", "setup"])(
  "rolls back failure after %s",
  async (stage) => {
    const f = await setup();
    const store = createImportStore(f.path, (current) => {
      if (current === stage) throw new Error("Synthetic failure");
    });
    await expect(
      store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
    ).rejects.toThrow("Synthetic failure");
    expect(readSetup(f.path)).toMatchObject({ state: "open", revision: 1 });
    const c = openDatabase(f.path);
    try {
      for (const name of [
        "import_runs",
        "import_sources",
        "accounts",
        "changes",
        "import_register_rows",
        "transactions",
      ])
        expect(c.sqlite.prepare(`SELECT count(*) AS n FROM ${name}`).get()).toEqual({ n: 0 });
    } finally {
      c.sqlite.close();
    }
  },
);
it("rejects changed source bytes and replacement with identical database bytes", async () => {
  const f = await setup();
  f.sources.register.bytes[0] = 0;
  await expect(
    f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
  ).rejects.toThrow("changed-source");
  const replacement = join(f.directory, "replacement.sqlite");
  copyFileSync(f.path, replacement);
  renameSync(replacement, f.path);
  expect(() => f.store.eligible(f.review.target)).toThrow("stale-target");
  expect(readSetup(f.path).state).toBe("open");
});

it("backup failure prevents household writes and setup completion", async () => {
  const f = await setup();
  const fail = vi
    .spyOn(Database.prototype, "backup")
    .mockRejectedValue(new Error("Synthetic backup failure"));
  try {
    await expect(
      f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
    ).rejects.toThrow("Synthetic backup failure");
  } finally {
    fail.mockRestore();
  }
  expect(readSetup(f.path)).toMatchObject({ state: "open", revision: 1 });
});
it("retains a Tracking observation and its source adjustment without live entries or manual snapshots", async () => {
  const f = await setup();
  const keys = f.sources.register.rows.map((r) => r.key);
  if (!keys[0] || !keys[1]) throw new Error("fixture");
  const decisions: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "tracking",
      name: "Synthetic Tracking",
      kind: "tracking",
      closed: true,
    },
    ...keys.map((key, index) => ({
      tag: "row" as const,
      key,
      accountKey: "account:1",
      treatment: "posted" as const,
      postedOn: "2026-10-20",
      payee: null,
      role: index === 0 ? ("opening" as const) : ("adjustment" as const),
    })),
    {
      tag: "observation",
      key: "observation",
      accountKey: "account:1",
      rowKey: keys[1],
      date: "2026-10-20",
      cents: -2000,
    },
  ];
  const review = { ...f.review, decisions },
    derived = deriveReview(f.sources, decisions, "2026-10-22");
  expect(derived.ready).toBe(true);
  const observations = checkTrackingHistory(derived);
  await f.store.commit(review, f.sources, derived, observations, "2026-10-22T12:00:00Z");
  const history = createImportHistoryStore(f.path).register("tracking", 100, 0);
  expect(history.observations).toMatchObject([
    {
      sourceRowId: keys[1],
      observedCents: -2000,
      originalAdjustmentCents: -1000,
      currentAdjustmentCents: -1000,
      state: "verified",
    },
  ]);
  expect(history.posted).toHaveLength(2);
  const c = openDatabase(f.path);
  try {
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM transactions").get()).toEqual({ n: 0 });
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM snapshots").get()).toEqual({ n: 0 });
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM reconciliations").get()).toEqual({ n: 0 });
  } finally {
    c.sqlite.close();
  }
});
it("rechecks target identity after transaction writes", async () => {
  const f = await setup();
  const replacement = join(f.directory, "racing-copy.sqlite");
  copyFileSync(f.path, replacement);
  const store = createImportStore(f.path, (stage) => {
    if (stage === "sources") renameSync(replacement, f.path);
  });
  await expect(
    store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
  ).rejects.toThrow("stale-target");
  expect(readSetup(f.path).state).toBe("open");
});

it("rejects malformed saved Tracking adjustment totals", async () => {
  const f = await setup();
  const receipt = await f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z");
  expect(() =>
    parseImportReceipt(
      JSON.stringify({
        ...receipt,
        report: {
          ...receipt.report,
          trackingAdjustments: {
            originalCents: 0.5,
            activeCents: 0,
            revisionEffectCents: 0,
            unverified: -1,
          },
        },
      }),
    ),
  ).toThrow("invalid-import-receipt");
});
