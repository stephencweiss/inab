import { describe, expect, it } from "vitest";
import { parseReviewEnvelope } from "../../src/accounts/imports/parse-review.js";
export function reviewFixture() {
  return {
    version: 1,
    reviewId: "review-1",
    revision: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    target: {
      id: "db-1",
      path: "/private/synthetic/db.sqlite",
      schemaVersion: 2,
      setupRevision: 1,
      fileIdentity: { device: "1", inode: "2" },
    },
    sources: {
      register: { path: "/private/synthetic/register.csv", sha256: "a".repeat(64), byteLength: 12 },
      plan: { path: "/private/synthetic/plan.csv", sha256: "b".repeat(64), byteLength: 10 },
    },
    decisions: [],
  };
}
describe("review envelope boundary", () => {
  it("accepts the complete envelope", () =>
    expect(parseReviewEnvelope(reviewFixture())).toEqual(reviewFixture()));
  it.each(["ready", "totals", "sql"])("refuses extra %s", (key) =>
    expect(() => parseReviewEnvelope({ ...reviewFixture(), [key]: true })).toThrow(
      "invalid-review",
    ),
  );
  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])("refuses revision %s", (revision) =>
    expect(() => parseReviewEnvelope({ ...reviewFixture(), revision })).toThrow("invalid-review"),
  );
  it("refuses malformed nested identity", () => {
    const review = reviewFixture();
    review.target.fileIdentity.inode = "2.5";
    expect(() => parseReviewEnvelope(review)).toThrow("invalid-review");
  });
  it("rejects missing decision slots", () => {
    expect(() =>
      parseReviewEnvelope({ ...reviewFixture(), decisions: new Array<null>(1) }),
    ).toThrow("invalid-review");
  });
  it.each([null, "correct-data", "revise-adjustment", "defer"])(
    "accepts observation audit resolution %s",
    (resolution) => {
      const decision = {
        tag: "observation-audit",
        key: "old-observation",
        accountKey: "a",
        rowKey: "row",
        date: "2026-10-22",
        cents: -10,
        resolution,
      };
      expect(parseReviewEnvelope({ ...reviewFixture(), decisions: [decision] }).decisions).toEqual([
        decision,
      ]);
    },
  );
  it("rejects incomplete or extended observation audit input", () => {
    const decision = {
      tag: "observation-audit",
      key: "old-observation",
      accountKey: "a",
      rowKey: "row",
      date: "2026-10-22",
      cents: 0,
      resolution: null,
    };
    const invalid = [
      { ...decision, resolution: "ignore" },
      { ...decision, resolution: false },
      { ...decision, sql: "select" },
      { ...decision, date: "2026-02-30" },
      { ...decision, cents: 0.5 },
      { ...decision, rowKey: null },
    ];
    for (const value of invalid)
      expect(() => parseReviewEnvelope({ ...reviewFixture(), decisions: [value] })).toThrow(
        "invalid-review",
      );
    for (const key of Object.keys(decision)) {
      const value = Object.fromEntries(Object.entries(decision).filter(([name]) => name !== key));
      expect(() => parseReviewEnvelope({ ...reviewFixture(), decisions: [value] })).toThrow(
        "invalid-review",
      );
    }
  });
  it("validates every decision variant", () => {
    const decisions = [
      {
        tag: "account",
        key: "a",
        sourceAccount: "Cash",
        localId: "local",
        name: "Cash",
        kind: "cash",
        closed: false,
      },
      {
        tag: "row",
        key: "r",
        accountKey: null,
        treatment: "history",
        postedOn: null,
        payee: null,
        role: "transaction",
      },
      { tag: "observation", key: "o", accountKey: "a", rowKey: "r", date: "2026-10-22", cents: 0 },
      { tag: "opening", accountKey: "a", date: "2026-10-22", cents: -5 },
      { tag: "resolve", key: "x", choice: "defer" },
      { tag: "ack", key: "x" },
    ];
    expect(parseReviewEnvelope({ ...reviewFixture(), decisions }).decisions).toEqual(decisions);
    for (const decision of decisions)
      expect(() =>
        parseReviewEnvelope({ ...reviewFixture(), decisions: [{ ...decision, ready: true }] }),
      ).toThrow("invalid-review");
  });
  it.each([
    null,
    {},
    { tag: "opening", accountKey: "a", date: "2026-02-30", cents: 1 },
    {
      tag: "row",
      key: "r",
      accountKey: null,
      treatment: "posted",
      postedOn: null,
      payee: null,
      role: "sql",
    },
    { tag: "opening", accountKey: "a", date: "2026-10-22", cents: 1.2 },
  ])("rejects invalid decisions", (decision) =>
    expect(() => parseReviewEnvelope({ ...reviewFixture(), decisions: [decision] })).toThrow(
      "invalid-review",
    ),
  );
});
