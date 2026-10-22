import { expect, it } from "vitest";
import { deriveReview, sourceAccounts } from "../../src/accounts/imports/review.js";
import { buildImportReport } from "../../src/accounts/imports/report.js";
import type { LoadedSources, ReviewDecision } from "../../src/accounts/imports/types.js";

function sources(): LoadedSources {
  const value = {
    ordinal: 1,
    account: "Example",
    occurredOn: "2026-10-20",
    payee: "",
    memo: "",
    categoryGroup: "",
    category: "",
    categoryGroupCategory: "",
    flag: "",
    outflowCents: 1000,
    inflowCents: 0,
    cents: -1000,
    sourceStatus: "Cleared" as const,
    postedOn: null,
  };
  return {
    register: {
      path: "/synthetic/register.csv",
      sha256: "a".repeat(64),
      bytes: new Uint8Array(),
      rows: [1, 2].map((ordinal) => ({
        key: `register:${"a".repeat(64)}:${ordinal}`,
        ordinal,
        raw: "",
        original: {},
        value: { ...value, ordinal },
        error: null,
      })),
    },
    plan: {
      path: "/synthetic/plan.csv",
      sha256: "b".repeat(64),
      bytes: new Uint8Array(),
      rows: [],
    },
  };
}
function decisions(): ReviewDecision[] {
  return [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local-1",
      name: "Example",
      kind: "cash",
      closed: false,
    },
    { tag: "opening", accountKey: "account:1", date: "2026-10-20", cents: 10000 },
    { tag: "ack", key: "history:account:1" },
  ];
}
it("retains identical source rows separately without inventing posting evidence", () => {
  const review = deriveReview(sources(), decisions(), "2026-10-22");
  expect(review.ready).toBe(true);
  expect(review.rows).toHaveLength(2);
  expect(new Set(review.rows.map((row) => row.key)).size).toBe(2);
  expect(
    review.rows.every((row) => row.postedOn === null && row.disposition === "history-only"),
  ).toBe(true);
  expect(buildImportReport(review)).toMatchObject({
    sourceRows: 2,
    historyOnly: 2,
    liveLinked: 0,
    sourceNetCents: -2000,
    liveBalanceEffectCents: 0,
  });
});
it("requires explicit account class and opening confirmation", () => {
  expect(deriveReview(sources(), [], "2026-10-22").ready).toBe(false);
  expect(
    deriveReview(
      sources(),
      decisions().filter((d) => d.tag !== "opening"),
      "2026-10-22",
    ).ready,
  ).toBe(false);
  expect(sourceAccounts(sources())).toEqual([{ key: "account:1", name: "Example" }]);
});
it("rejects promotion of posting already covered by opening", () => {
  const data = sources();
  const row = data.register.rows[0];
  if (!row) throw new Error("missing fixture");
  const choice: ReviewDecision = {
    tag: "row",
    key: row.key,
    accountKey: null,
    treatment: "posted",
    postedOn: "2026-10-20",
    payee: "Synthetic",
    role: "transaction",
  };
  expect(
    deriveReview(data, [...decisions(), choice], "2026-10-22").issues.some(
      (i) => i.reason === "posting-in-opening-period",
    ),
  ).toBe(true);
});
it("keeps pending distinct from a confirmed bank posting", () => {
  const data = sources();
  const row = data.register.rows[0];
  if (!row) throw new Error("missing fixture");
  const choice: ReviewDecision = {
    tag: "row",
    key: row.key,
    accountKey: null,
    treatment: "pending",
    postedOn: null,
    payee: "Synthetic",
    role: "transaction",
  };
  const review = deriveReview(data, [...decisions(), choice], "2026-10-22");
  expect(review.ready).toBe(true);
  expect(review.rows[0]).toMatchObject({ disposition: "live-linked", postedOn: null });
});
it("does not silently merge separate groups with the same source label", () => {
  const data = sources();
  const row = data.register.rows[1];
  if (!row) throw new Error("missing fixture");
  const ds: ReviewDecision[] = [
    ...decisions(),
    {
      tag: "account",
      key: "group-2",
      sourceAccount: "account:1",
      localId: "local-2",
      name: "Other",
      kind: "tracking",
      closed: true,
    },
    {
      tag: "row",
      key: row.key,
      accountKey: "group-2",
      treatment: "history",
      postedOn: null,
      payee: null,
      role: "transaction",
    },
    { tag: "ack", key: "history:group-2" },
  ];
  const review = deriveReview(data, ds, "2026-10-22");
  expect(review.ready).toBe(true);
  expect(review.rows.map((r) => r.accountKey)).toEqual(["account:1", "group-2"]);
});

it("rejects two decisions for one source row instead of ignoring an edit", () => {
  const data = sources();
  const row = data.register.rows[0];
  if (!row) throw new Error("missing fixture");
  const choice: ReviewDecision = {
    tag: "row",
    key: row.key,
    accountKey: null,
    treatment: "history",
    postedOn: null,
    payee: null,
    role: "transaction",
  };
  expect(
    deriveReview(
      data,
      [...decisions(), choice, { ...choice, treatment: "pending", payee: "Local" }],
      "2026-10-22",
    ).ready,
  ).toBe(false);
});
it("keeps acknowledged history uncertainty visible in the report", () => {
  const review = deriveReview(sources(), decisions(), "2026-10-22");
  expect(review.issues).toContainEqual({
    key: "history:account:1",
    reason: "unverified-history-coverage",
    blocking: false,
    rowKey: null,
  });
});
it("rejects live entries whose combined account balance overflows", () => {
  const data = sources();
  const ds = decisions().map((d) =>
    d.tag === "opening" ? { ...d, cents: -Number.MAX_SAFE_INTEGER } : d,
  );
  const choices: ReviewDecision[] = data.register.rows.map((row) => ({
    tag: "row",
    key: row.key,
    accountKey: null,
    treatment: "pending",
    postedOn: null,
    payee: "Local",
    role: "transaction",
  }));
  expect(deriveReview(data, [...ds, ...choices], "2026-10-22").ready).toBe(false);
});

it("retains conflicting monthly rows after explicit acknowledgment", () => {
  const data = sources();
  data.plan.rows = [100, 200].map((assignedCents, index) => ({
    key: `plan:${index + 1}`,
    ordinal: index + 1,
    raw: "",
    original: {},
    error: null,
    value: {
      ordinal: index + 1,
      month: "2026-10",
      categoryGroupCategory: "Group/Category",
      categoryGroup: "Group",
      category: "Category",
      assignedCents,
      activityCents: 0,
      availableCents: assignedCents,
    },
  }));
  const blocked = deriveReview(data, decisions(), "2026-10-22");
  expect(blocked.ready).toBe(false);
  const reviewed = deriveReview(
    data,
    [...decisions(), { tag: "ack", key: "plan-conflict:1" }],
    "2026-10-22",
  );
  expect(reviewed.ready).toBe(true);
  expect(reviewed.planRows).toHaveLength(2);
  expect(reviewed.issues).toContainEqual({
    key: "plan-conflict:1",
    reason: "conflicting-monthly-values",
    blocking: false,
    rowKey: null,
  });
});
it("rejects reuse of one source adjustment for two observations", () => {
  const data = sources();
  const source = data.register.rows[0];
  if (!source) throw new Error("missing fixture");
  const ds: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local-1",
      name: "Tracking",
      kind: "tracking",
      closed: false,
    },
    { tag: "ack", key: "history:account:1" },
    {
      tag: "row",
      key: source.key,
      accountKey: null,
      treatment: "posted",
      postedOn: "2026-10-20",
      payee: null,
      role: "adjustment",
    },
    {
      tag: "observation",
      key: "observation-1",
      accountKey: "account:1",
      rowKey: source.key,
      date: "2026-10-20",
      cents: 100,
    },
    {
      tag: "observation",
      key: "observation-2",
      accountKey: "account:1",
      rowKey: source.key,
      date: "2026-10-21",
      cents: 200,
    },
  ];
  const review = deriveReview(data, ds, "2026-10-22");
  expect(review.ready).toBe(false);
  expect(review.issues.some((issue) => issue.reason === "duplicate-observation")).toBe(true);
});
it("rejects two retained observations for one account and day", () => {
  const data = sources();
  const rows: ReviewDecision[] = data.register.rows.map((row) => ({
    tag: "row",
    key: row.key,
    accountKey: null,
    treatment: "posted",
    postedOn: "2026-10-20",
    payee: null,
    role: "adjustment",
  }));
  const observations: ReviewDecision[] = data.register.rows.map((row) => ({
    tag: "observation",
    key: `observation-${row.ordinal}`,
    accountKey: "account:1",
    rowKey: row.key,
    date: "2026-10-20",
    cents: 100,
  }));
  const ds: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local-1",
      name: "Tracking",
      kind: "tracking",
      closed: false,
    },
    ...rows,
    ...observations,
  ];
  expect(
    deriveReview(data, ds, "2026-10-22").issues.some(
      (issue) => issue.reason === "duplicate-observation",
    ),
  ).toBe(true);
});
it("reports absent split parents and unresolved transfer labels without inventing links", () => {
  const input = sources();
  const row = input.register.rows[0];
  if (!row?.value) throw new Error("missing fixture");
  row.value.payee = "Transfer : Synthetic savings";
  const review = deriveReview(input, decisions(), "2026-10-22");
  expect(review.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "split-parent-data-unavailable", blocking: false }),
      expect.objectContaining({ reason: "unresolved-transfer", rowKey: row.key, blocking: false }),
    ]),
  );
  expect(review.rows).toHaveLength(2);
});
function reviewBalanceExample(
  amounts: number[],
  treatments: ("pending" | "posted")[],
  dates: string[],
  openingCents: number,
) {
  const data = sources();
  const base = data.register.rows[0];
  if (!base?.value) throw new Error("missing fixture");
  const value = base.value;
  data.register.rows = amounts.map((cents, index) => ({
    ...base,
    key: `balance-row-${index}`,
    ordinal: index + 1,
    value: { ...value, ordinal: index + 1, cents, occurredOn: dates[index] ?? "2026-10-20" },
  }));
  const ds: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local",
      name: "Example",
      kind: "cash",
      closed: false,
    },
    { tag: "opening", accountKey: "account:1", date: "2026-10-19", cents: openingCents },
    ...data.register.rows.map((row, index): ReviewDecision => ({
      tag: "row",
      key: row.key,
      accountKey: null,
      treatment: treatments[index] ?? "pending",
      postedOn: treatments[index] === "posted" ? (row.value?.occurredOn ?? null) : null,
      role: "transaction",
      payee: "Example",
    })),
  ];
  return deriveReview(data, ds, "2026-10-22");
}
it("rejects cleared overflow even when a pending amount keeps the working total safe", () => {
  expect(
    reviewBalanceExample(
      [-1, 1],
      ["pending", "posted"],
      ["2026-10-20", "2026-10-21"],
      Number.MAX_SAFE_INTEGER,
    ).ready,
  ).toBe(false);
});
it("rejects uncleared overflow hidden by a cleared offset", () => {
  expect(
    reviewBalanceExample(
      [Number.MAX_SAFE_INTEGER, -1, 1],
      ["pending", "posted", "pending"],
      ["2026-10-20", "2026-10-21", "2026-10-22"],
      0,
    ).ready,
  ).toBe(false);
});
it("uses canonical register order for intermediate balance range checks", () => {
  expect(
    reviewBalanceExample(
      [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1],
      ["pending", "pending", "pending"],
      ["2026-10-22", "2026-10-20", "2026-10-21"],
      0,
    ).ready,
  ).toBe(false);
});
