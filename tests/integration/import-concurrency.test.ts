import { afterEach, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { createImportStore } from "../../src/storage/imports.js";
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
it("two confirmations reuse the same receipt and only one import commits", async () => {
  const f = await setup();
  const second = createImportStore(f.path);
  const receipts = await Promise.all([
    f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
    second.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
  ]);
  expect(receipts.filter((r) => !r.reused)).toHaveLength(1);
  expect(receipts.filter((r) => r.reused)).toHaveLength(1);
  expect(receipts[0]?.importId).toBe(receipts[1]?.importId);
  const c = openDatabase(f.path);
  try {
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM import_runs").get()).toEqual({ n: 1 });
    expect(c.sqlite.prepare("SELECT count(*) AS n FROM changes").get()).toEqual({ n: 1 });
  } finally {
    c.sqlite.close();
  }
});
it("two different reviews cannot both commit", async () => {
  const f = await setup();
  const second = createImportStore(f.path),
    other = { ...f.review, reviewId: "other" };
  const results = await Promise.allSettled([
    f.store.commit(f.review, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
    second.commit(other, f.sources, f.derived, [], "2026-10-22T12:00:00Z"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
