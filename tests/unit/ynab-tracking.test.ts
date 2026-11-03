import { expect, it } from "vitest";
import { checkTrackingObservation } from "../../src/accounts/imports/tracking.js";
const entries = [
  {
    key: "opening",
    cents: 10000,
    postedOn: "2026-10-01",
    role: "opening" as const,
    treatment: "posted" as const,
  },
  {
    key: "spend",
    cents: -1000,
    postedOn: "2026-10-02",
    role: "transaction" as const,
    treatment: "posted" as const,
  },
  {
    key: "income",
    cents: 1500,
    postedOn: "2026-10-03",
    role: "transaction" as const,
    treatment: "posted" as const,
  },
  {
    key: "adjustment",
    cents: 2500,
    postedOn: "2026-10-04",
    role: "adjustment" as const,
    treatment: "posted" as const,
  },
];
const observation = { rowKey: "adjustment", date: "2026-10-04", cents: 13000 };
it("counts the source adjustment once and never adds the observed balance", () => {
  expect(checkTrackingObservation(entries, observation, null)).toMatchObject({
    status: "verified",
    recordedCents: 13000,
    observedCents: 13000,
    differenceCents: 0,
    adjustmentCents: 2500,
  });
});
it("flags changed evidence and revises an adjustment only on explicit review", () => {
  const changed = entries.map((e) => (e.key === "spend" ? { ...e, cents: -1500 } : e));
  expect(checkTrackingObservation(changed, observation, null)).toMatchObject({
    status: "needs-review",
    recordedCents: 12500,
    differenceCents: 500,
    adjustmentCents: 2500,
  });
  expect(checkTrackingObservation(changed, observation, "revise-adjustment")).toMatchObject({
    status: "verified",
    recordedCents: 13000,
    differenceCents: 0,
    adjustmentCents: 3000,
  });
});
it("excludes pending and later-posted activity from the closing observation", () => {
  expect(
    checkTrackingObservation(
      [
        ...entries,
        {
          key: "late",
          cents: -1000,
          postedOn: "2026-10-05",
          role: "transaction",
          treatment: "posted",
        },
        { key: "pending", cents: -1000, postedOn: null, role: "transaction", treatment: "pending" },
      ],
      observation,
      null,
    ).status,
  ).toBe("verified");
});
it("does not invent an opening or posting date", () => {
  expect(checkTrackingObservation(entries.slice(1), observation, null)).toMatchObject({
    status: "unverified",
    reason: "missing-opening",
  });
  const unknown = entries.map((e) =>
    e.key === "spend" ? { ...e, postedOn: null, treatment: "history" as const } : e,
  );
  expect(checkTrackingObservation(unknown, observation, null)).toMatchObject({
    status: "unverified",
    reason: "missing-posting",
  });
});

it("does not use a pending opening as a confirmed baseline", () => {
  const changed = entries.map((entry) =>
    entry.role === "opening" ? { ...entry, treatment: "pending" as const } : entry,
  );
  expect(checkTrackingObservation(changed, observation, null)).toMatchObject({
    status: "unverified",
    reason: "missing-opening",
  });
});
it("does not apply a pending adjustment to a closing observation", () => {
  const changed = entries.map((entry) =>
    entry.role === "adjustment" ? { ...entry, treatment: "pending" as const } : entry,
  );
  expect(checkTrackingObservation(changed, observation, null)).toMatchObject({
    status: "unverified",
    reason: "missing-posting",
  });
});
it("does not sum two competing opening baselines", () => {
  const first = entries[0];
  if (!first) throw new Error("missing opening fixture");
  expect(
    checkTrackingObservation([...entries, { ...first, key: "second-opening" }], observation, null),
  ).toMatchObject({ status: "unverified", reason: "missing-opening" });
});

it("keeps a deferred observation flagged even when its arithmetic matches", () => {
  expect(checkTrackingObservation(entries, observation, "defer")).toMatchObject({
    status: "needs-review",
    differenceCents: 0,
    adjustmentCents: 2500,
  });
});
it("rejects unsafe integer arithmetic instead of rounding a balance", () => {
  const changed = entries.map((entry) =>
    entry.role === "opening" ? { ...entry, cents: Number.MAX_SAFE_INTEGER } : entry,
  );
  expect(() => checkTrackingObservation(changed, observation, null)).toThrow("unsafe-cents");
});
