import { expect, it } from "vitest";
import { deriveReview, sourceAccounts } from "../../src/accounts/imports/review.js";
import { buildImportReport } from "../../src/accounts/imports/report.js";
import { checkTrackingHistory } from "../../src/accounts/imports/observations.js";
import type { LoadedSources, ReviewDecision } from "../../src/accounts/imports/types.js";
import type { MigrationView } from "../../src/cli/migration-guide-types.js";
import { migrationProgress } from "../../src/cli/migration-progress.js";

function sources(names = ["Demo cash", "Demo cash"]): LoadedSources {
  return {
    register: {
      path: "/synthetic/register.csv",
      sha256: "register",
      bytes: new Uint8Array(),
      rows: names.map((account, index) => ({
        key: `source:${index + 1}`,
        ordinal: index + 2,
        raw: "",
        original: {},
        error: null,
        value: {
          ordinal: index + 2,
          account,
          occurredOn: "2026-10-20",
          postedOn: null,
          payee: "Demo shop",
          memo: "",
          categoryGroupCategory: "",
          categoryGroup: "",
          category: "",
          flag: "",
          outflowCents: 100,
          inflowCents: 0,
          cents: -100,
          sourceStatus: "Cleared",
        },
      })),
    },
    plan: { path: "/synthetic/plan.csv", sha256: "plan", bytes: new Uint8Array(), rows: [] },
  };
}
function view(input: LoadedSources, decisions: ReviewDecision[] = []): MigrationView {
  const derived = deriveReview(input, decisions, "2026-10-30");
  return {
    reviewId: "synthetic-review",
    revision: 1,
    sourceAccounts: sourceAccounts(input),
    derived,
    report: buildImportReport(derived),
    observations: checkTrackingHistory(derived),
  };
}
function account(
  key = "account:1",
  source = "account:1",
  kind: "cash" | "credit" | "tracking" = "cash",
): ReviewDecision {
  return {
    tag: "account",
    key,
    sourceAccount: source,
    localId: `local:${key}`,
    name: `Demo ${key}`,
    kind,
    closed: false,
  };
}
function opening(key = "account:1"): ReviewDecision {
  return { tag: "opening", accountKey: key, date: "2026-10-22", cents: 10000 };
}
it("plans three initial account steps instead of counting duplicate unmapped rows", () => {
  const input = view(sources());
  expect(input.derived.issues.filter((issue) => issue.blocking)).toHaveLength(3);
  expect(migrationProgress(input)).toMatchObject({
    remaining: 3,
    warnings: 1,
    conditional: true,
    steps: [
      { key: "mapping:account:1" },
      { key: "opening:account:1" },
      { key: "history:account:1" },
    ],
  });
  expect(migrationProgress(input).steps[1]?.label).toMatch(/Cash.*Credit|cash.*credit/);
});
it("advances from three planned steps to two, one, then none as choices are saved", () => {
  const input = sources();
  const decisions: ReviewDecision[] = [];
  expect(migrationProgress(view(input, decisions)).remaining).toBe(3);
  decisions.push(account());
  expect(migrationProgress(view(input, decisions))).toMatchObject({
    remaining: 2,
    conditional: false,
    steps: [{ key: "opening:account:1" }, { key: "history:account:1" }],
  });
  decisions.push(opening());
  expect(migrationProgress(view(input, decisions))).toMatchObject({
    remaining: 1,
    steps: [{ key: "history:account:1" }],
  });
  decisions.push({ tag: "ack", key: "history:account:1" });
  expect(migrationProgress(view(input, decisions))).toMatchObject({
    remaining: 0,
    warnings: 2,
    conditional: false,
    steps: [],
  });
});
it("does not require a Cash or Credit opening after the user selects Tracking", () => {
  const input = sources();
  const progress = migrationProgress(view(input, [account("account:1", "account:1", "tracking")]));
  expect(progress).toMatchObject({
    remaining: 1,
    conditional: false,
    steps: [{ key: "history:account:1" }],
  });
});
it("keeps independent planned steps for each unmapped source account", () => {
  const progress = migrationProgress(view(sources(["Demo cash", "Demo credit"])));
  expect(progress.remaining).toBe(6);
  expect(new Set(progress.steps.map((step) => step.key)).size).toBe(6);
});
it("keeps separate split group openings and history steps", () => {
  const input = sources();
  const decisions: ReviewDecision[] = [account(), account("group:second")];
  decisions.push({
    tag: "row",
    key: "source:2",
    accountKey: "group:second",
    treatment: "history",
    postedOn: null,
    payee: null,
    role: "transaction",
  });
  const progress = migrationProgress(view(input, decisions));
  expect(progress.remaining).toBe(4);
  expect(progress.steps.map((step) => step.key)).toEqual([
    "opening:account:1",
    "opening:group:second",
    "history:account:1",
    "history:group:second",
  ]);
});
it("retains unmapped row blockers when only an extra group exists", () => {
  const input = view(sources(), [account("group:second")]);
  expect(input.derived.issues.some((issue) => issue.key === "mapping:account:1")).toBe(false);
  const progress = migrationProgress(input);
  expect(progress.conditional).toBe(false);
  expect(progress.steps.map((step) => step.key)).toEqual([
    "opening:group:second",
    "source:1",
    "source:2",
    "empty:group:second",
  ]);
  expect(progress.remaining).toBe(4);
});
it("preserves other real blockers and excludes warnings from required steps", () => {
  const input = sources();
  const broken = input.register.rows[1];
  if (!broken) throw new Error("Missing fixture row");
  broken.value = null;
  broken.error = "invalid-amount";
  const decisions: ReviewDecision[] = [
    account(),
    opening(),
    { tag: "ack", key: "history:account:1" },
  ];
  const progress = migrationProgress(view(input, decisions));
  expect(progress).toMatchObject({
    remaining: 1,
    warnings: 2,
    conditional: false,
    steps: [{ key: "source:2", label: "invalid amount" }],
  });
});
it("does not change the inspected review while calculating progress", () => {
  const input = view(sources());
  const original = structuredClone(input);
  migrationProgress(input);
  expect(input).toEqual(original);
});

it("counts opening-period conflicts once per affected row instead of adding the repeated balance check", () => {
  const input = sources();
  const decisions: ReviewDecision[] = [
    account(),
    opening(),
    ...input.register.rows.map((source): ReviewDecision => ({
      tag: "row",
      key: source.key,
      accountKey: "account:1",
      treatment: "posted",
      postedOn: "2026-10-21",
      role: "transaction",
      payee: "Demo shop",
    })),
  ];
  const current = view(input, decisions);
  expect(
    current.derived.issues.filter((issue) => issue.reason === "posting-in-opening-period"),
  ).toHaveLength(3);
  expect(migrationProgress(current).remaining).toBe(2);
  expect(current.derived.ready).toBe(false);
});
