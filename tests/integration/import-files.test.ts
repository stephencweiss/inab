import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  statSync,
  readFileSync,
  symlinkSync,
  linkSync,
  truncateSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ReviewEnvelope } from "../../src/accounts/imports/types.js";
import { readSources } from "../../src/adapters/ynab/files.js";
import {
  createReview,
  readReview,
  updateReview,
  withReviewLock,
} from "../../src/adapters/ynab/review-file.js";
import {
  csvText,
  registerFields,
  registerHeaders,
  planFields,
  planHeaders,
} from "../helpers/ynab.js";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "inab-import-"));
  roots.push(root);
  const register = join(root, "register.csv");
  const plan = join(root, "plan.csv");
  writeFileSync(register, "\ufeff" + csvText(registerHeaders, [registerFields()]));
  writeFileSync(plan, csvText(planHeaders, [planFields()]));
  const source = (path: string) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    byteLength: statSync(path).size,
  });
  const review: ReviewEnvelope = {
    version: 1,
    reviewId: "r",
    revision: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    target: {
      id: "db",
      path: join(root, "db.sqlite"),
      schemaVersion: 2,
      setupRevision: 1,
      fileIdentity: { device: "1", inode: "2" },
    },
    sources: { register: source(register), plan: source(plan) },
    decisions: [],
  };
  return { root, register, plan, review };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("private import files", () => {
  it("hashes exact bytes and retains malformed fields", () => {
    const f = fixture();
    const text =
      "\ufeff" +
      csvText(registerHeaders, [
        [...registerFields().slice(0, 2), "bad", ...registerFields().slice(3)],
      ]);
    writeFileSync(f.register, text);
    const sources = readSources(f.register, f.plan);
    expect(sources.register.sha256).toBe(createHash("sha256").update(text).digest("hex"));
    expect(sources.register.rows[0]).toMatchObject({
      ordinal: 1,
      value: null,
      error: "invalid-date",
    });
    expect(sources.register.rows[0]?.key).toBe(`register:${sources.register.sha256}:1`);
  });
  it("rejects symlinks and identical source inodes", () => {
    const f = fixture();
    const alias = join(f.root, "alias");
    symlinkSync(f.register, alias);
    expect(() => readSources(alias, f.plan)).toThrow();
    rmSync(alias);
    linkSync(f.register, alias);
    expect(() => readSources(f.register, alias)).toThrow();
  });
  it("creates exclusive private reviews", () => {
    const f = fixture();
    const path = join(f.root, "private", "review.json");
    createReview(path, f.review, []);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(f.root, "private")).mode & 0o777).toBe(0o700);
    expect(readReview(path)).toEqual(f.review);
    expect(() => createReview(path, f.review, [])).toThrow();
  });
  it("refuses aliases, malformed JSON and oversized inputs", () => {
    const f = fixture();
    expect(() => createReview(f.register, f.review, [f.register])).toThrow();
    const path = join(f.root, "review.json");
    writeFileSync(path, '{"version":99}');
    expect(() => readReview(path)).toThrow("invalid-review");
  });
  it("bounds descriptor reads and rejects invalid UTF-8 and directories", () => {
    const f = fixture();
    truncateSync(f.register, 64 * 1024 * 1024 + 1);
    expect(() => readSources(f.register, f.plan)).toThrow("input-limit");
    expect(() => readReview(f.register)).toThrow("input-limit");
    writeFileSync(f.register, Buffer.from([0xff]));
    expect(() => readSources(f.register, f.plan)).toThrow("invalid-csv");
    expect(() => readReview(f.register)).toThrow("invalid-review");
    expect(() => readSources(f.root, f.plan)).toThrow("invalid-path");
  });
  it("refuses source hardlinks as review destinations", () => {
    const f = fixture();
    const alias = join(f.root, "alias.json");
    linkSync(f.register, alias);
    expect(() => createReview(alias, f.review, [f.register])).toThrow("review-alias");
  });
  it("keeps stale locks and releases only its own lock", async () => {
    const f = fixture();
    const path = join(f.root, "review.json");
    createReview(path, f.review, []);
    writeFileSync(`${path}.lock`, "stale");
    await expect(withReviewLock(path, () => 0)).rejects.toThrow("review-locked");
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("stale");
    rmSync(`${path}.lock`);
    await withReviewLock(path, () => {
      rmSync(`${path}.lock`);
      writeFileSync(`${path}.lock`, "replacement");
    });
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("replacement");
  });
  it("releases locks on asynchronous failure", async () => {
    const f = fixture();
    const path = join(f.root, "review.json");
    createReview(path, f.review, []);
    await expect(
      withReviewLock(path, async () => {
        await Promise.resolve();
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(existsSync(`${path}.lock`)).toBe(false);
    await expect(updateReview(path, 1, (r) => ({ ...r, revision: 1 }))).rejects.toThrow(
      "invalid-review",
    );
    expect(readReview(path).revision).toBe(1);
  });
  it("locks updates, checks revisions and preserves prior output on error", async () => {
    const f = fixture();
    const path = join(f.root, "review.json");
    createReview(path, f.review, []);
    await expect(updateReview(path, 2, (r) => r)).rejects.toThrow("stale-review");
    await expect(
      updateReview(path, 1, () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(readReview(path).revision).toBe(1);
    await updateReview(path, 1, (r) => ({ ...r, revision: 2 }));
    expect(readReview(path).revision).toBe(2);
    await withReviewLock(path, async () => {
      await expect(withReviewLock(path, () => 0)).rejects.toThrow("review-locked");
    });
  });
});
