import { expect, it } from "vitest";
import { deriveReview } from "../../src/accounts/imports/review.js";
import { checkTrackingHistory } from "../../src/accounts/imports/observations.js";
import type { LoadedSources, ReviewDecision } from "../../src/accounts/imports/types.js";
it("excludes discarded observation adjustments while retaining their source evidence", () => {
  const amounts = [10000, 2500, 3000];
  const rows = amounts.map((cents, index) => ({
    key: `row-${index}`,
    ordinal: index + 1,
    raw: "",
    original: {},
    error: null,
    value: {
      ordinal: index + 1,
      account: "Tracking example",
      occurredOn: index === 0 ? "2026-10-01" : "2026-10-20",
      postedOn: null,
      payee: "Example",
      memo: "",
      categoryGroup: "",
      category: "",
      categoryGroupCategory: "",
      flag: "",
      outflowCents: 0,
      inflowCents: cents,
      cents,
      sourceStatus: "Cleared" as const,
    },
  }));
  const sources: LoadedSources = {
    register: { path: "/example/r", sha256: "a".repeat(64), bytes: new Uint8Array(), rows },
    plan: { path: "/example/p", sha256: "b".repeat(64), bytes: new Uint8Array(), rows: [] },
  };
  const decisions: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local",
      name: "Example",
      kind: "tracking",
      closed: false,
    },
    ...rows.map((row): ReviewDecision => ({
      tag: "row",
      key: row.key,
      accountKey: null,
      treatment: "posted",
      postedOn: row.value.occurredOn,
      payee: null,
      role: row.ordinal === 1 ? "opening" : "adjustment",
    })),
    {
      tag: "observation-audit",
      key: "discarded",
      accountKey: "account:1",
      rowKey: "row-1",
      date: "2026-10-20",
      cents: 12500,
      resolution: null,
    },
    {
      tag: "observation",
      key: "retained",
      accountKey: "account:1",
      rowKey: "row-2",
      date: "2026-10-20",
      cents: 13000,
    },
  ];
  const review = deriveReview(sources, decisions, "2026-10-22");
  expect(review.rows).toHaveLength(3);
  expect(checkTrackingHistory(review)[0]?.check).toMatchObject({
    status: "verified",
    recordedCents: 13000,
    adjustmentCents: 3000,
  });
});
