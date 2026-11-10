import { mkdtempSync, statSync, symlinkSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createBudgetReviewFiles } from "../../src/adapters/budget/review-file.js";
import { parseBudgetFacts } from "../../src/budget/parse.js";
const { createBudgetReview, readBudgetReview, updateBudgetReview, withBudgetReviewLock } =
  createBudgetReviewFiles(parseBudgetFacts);
describe("private budget activation review", () => {
  it("creates a private incomplete review and rejects existing targets and stale changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inab-budget-review-"));
    const path = join(dir, "review.json");
    try {
      const review = {
        answers: [],
        answerThroughDate: null,
        draft: null,
        format: 1 as const,
        id: "review",
        revision: 1,
        targetPath: join(dir, "db"),
        targetId: "target",
        targetDevice: "1",
        targetInode: "1",
        baseline: "{}",
        expectedBudgetRevision: 0,
        month: "2026-10",
        mode: "activate" as const,
        facts: null,
        coverage: null,
        preview: null,
      };
      createBudgetReview(path, review);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readBudgetReview(path).facts).toBeNull();
      expect(() => createBudgetReview(path, review)).toThrow();
      await updateBudgetReview(path, 1, (r) => ({ ...r, revision: 2 }));
      await expect(updateBudgetReview(path, 1, (r) => ({ ...r, revision: 2 }))).rejects.toThrow(
        "stale-review",
      );
      expect(JSON.parse(readFileSync(path, "utf8")).revision).toBe(2);
      await withBudgetReviewLock(path, async () => {
        await expect(withBudgetReviewLock(path, () => true)).rejects.toThrow("review-locked");
      });
      const link = join(dir, "link");
      symlinkSync(path, link);
      expect(() => readBudgetReview(link)).toThrow();
      expect(() => createBudgetReview(link, review)).toThrow();
      const legacy = JSON.parse(readFileSync(path, "utf8"));
      delete legacy.draft;
      writeFileSync(path, JSON.stringify(legacy));
      expect(readBudgetReview(path).draft).toBeNull();
      const draft = {
        facts: {
          startMonth: "2026-10",
          currency: "USD" as const,
          opening: {
            accounts: [],
            categories: [],
            readyToAssignCents: 0,
            evidence: "reviewed zero",
            deficitAcknowledged: false,
          },
          categories: [],
          assignments: [],
          events: [],
        },
        coverage: {
          throughDate: "2026-11-05",
          evidence: "no activity",
          includedTransactionIds: [],
          postedBridgeEventIds: [],
        },
      };
      await updateBudgetReview(path, 2, (r) => ({ ...r, revision: 3, draft }));
      expect(readBudgetReview(path).draft).toEqual(draft);
      expect(readBudgetReview(path).facts).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
