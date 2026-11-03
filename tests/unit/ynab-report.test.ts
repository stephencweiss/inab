import { expect, it } from "vitest";
import { deriveReview } from "../../src/accounts/imports/review.js";
import { buildImportReport } from "../../src/accounts/imports/report.js";
import type { LoadedSources, ReviewDecision } from "../../src/accounts/imports/types.js";
function invalidSources(): LoadedSources {
  return {
    register: {
      path: "/synthetic/register.csv",
      sha256: "a".repeat(64),
      bytes: new Uint8Array(),
      rows: [
        {
          key: "register:1",
          ordinal: 1,
          original: {},
          raw: "",
          value: null,
          error: "invalid-amount",
        },
      ],
    },
    plan: {
      path: "/synthetic/plan.csv",
      sha256: "b".repeat(64),
      bytes: new Uint8Array(),
      rows: [],
    },
  };
}
it("counts an invalid register row exactly once without treating its amount as zero", () => {
  const report = buildImportReport(deriveReview(invalidSources(), [], "2026-10-22"));
  expect(report).toMatchObject({
    sourceRows: 1,
    registerRows: 1,
    invalid: 1,
    historyOnly: 0,
    sourceNetCents: null,
  });
  expect(report.sourceRows).toBe(
    report.historyOnly + report.liveLinked + report.observationEvidence + report.invalid,
  );
});
it("reports invalid plan totals as unavailable and does not count their issues twice", () => {
  const data = invalidSources();
  data.plan.rows = [
    { key: "plan:1", ordinal: 1, original: {}, raw: "", value: null, error: "invalid-amount" },
  ];
  const report = buildImportReport(deriveReview(data, [], "2026-10-22"));
  expect(report).toMatchObject({
    sourceRows: 2,
    registerRows: 1,
    planRows: 1,
    invalid: 2,
    planColumnTotals: { assignedCents: null, activityCents: null, availableCents: null },
  });
});
function trackingReview() {
  const data = invalidSources();
  data.register.rows = [10000, -1500, 1500, 2500].map((cents, index) => ({
    key: `register:${index + 1}`,
    ordinal: index + 1,
    original: {},
    raw: "",
    error: null,
    value: {
      ordinal: index + 1,
      account: "Tracking",
      occurredOn: `2026-10-0${index + 1}`,
      postedOn: null,
      payee: "Synthetic",
      memo: "",
      categoryGroup: "",
      category: "",
      categoryGroupCategory: "",
      flag: "",
      sourceStatus: "Cleared",
      cents,
      outflowCents: Math.max(0, -cents),
      inflowCents: Math.max(0, cents),
    },
  }));
  const decisions: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local-1",
      name: "Tracking",
      kind: "tracking",
      closed: false,
    },
    ...data.register.rows.map((row, index): ReviewDecision => ({
      tag: "row",
      key: row.key,
      accountKey: null,
      treatment: "posted",
      postedOn: `2026-10-0${index + 1}`,
      payee: null,
      role: index === 0 ? "opening" : "transaction",
    })),
    {
      tag: "observation",
      key: "observation-1",
      accountKey: "account:1",
      rowKey: "register:4",
      date: "2026-10-04",
      cents: 13000,
    },
    { tag: "resolve", key: "observation-1", choice: "revise-adjustment" },
  ];
  const adjustment = decisions.find(
    (decision) => decision.tag === "row" && decision.key === "register:4",
  );
  if (!adjustment || adjustment.tag !== "row") throw new Error("missing adjustment fixture");
  adjustment.role = "adjustment";
  return deriveReview(data, decisions, "2026-10-22");
}
it("reports original and explicitly revised Tracking adjustments separately", () => {
  const report = buildImportReport(trackingReview());
  expect(report).toMatchObject({
    trackingAdjustments: {
      originalCents: 2500,
      activeCents: 3000,
      revisionEffectCents: 500,
      unverified: 0,
    },
    sourceNetCents: 12500,
    liveBalanceEffectCents: 0,
  });
});
it("retains an unverified source adjustment and reports its uncertainty", () => {
  const review = trackingReview();
  review.rows = review.rows.map((row) =>
    row.role === "opening" ? { ...row, role: "transaction" } : row,
  );
  expect(buildImportReport(review)).toMatchObject({
    trackingAdjustments: {
      originalCents: 2500,
      activeCents: 2500,
      revisionEffectCents: 0,
      unverified: 1,
    },
  });
});
it("reports unavailable adjustment totals when their sum exceeds safe cents", () => {
  const review = trackingReview();
  review.rows = review.rows
    .filter((row) => row.role === "adjustment")
    .map((row) => ({
      ...row,
      source: {
        ...row.source,
        value:
          row.source.value === null
            ? null
            : { ...row.source.value, cents: Number.MAX_SAFE_INTEGER },
      },
    }));
  const extra = review.rows[0];
  const observation = review.observations[0];
  if (!extra || !observation) throw new Error("missing observation fixture");
  review.rows.push({ ...extra, key: "register:5", source: { ...extra.source, key: "register:5" } });
  review.observations.push({
    ...observation,
    key: "observation-2",
    rowKey: "register:5",
    date: "2026-10-05",
  });
  expect(buildImportReport(review)).toMatchObject({
    trackingAdjustments: {
      originalCents: null,
      activeCents: null,
      revisionEffectCents: null,
      unverified: 2,
    },
  });
});
