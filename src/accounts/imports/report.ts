import { checkedSum } from "../../lib/money.js";
import { checkTrackingHistory } from "./observations.js";
import type { DerivedReview, LoadedRow } from "./types.js";
function total<T>(rows: LoadedRow<T>[], cents: (value: T) => number) {
  if (rows.some((row) => row.value === null))
    return { cents: null, reason: "invalid-source-value" };
  const values = rows.flatMap((row) => (row.value === null ? [] : [cents(row.value)]));
  const sum = checkedSum(values);
  return sum.ok ? { cents: sum.value, reason: null } : { cents: null, reason: sum.reason };
}
function dispositionCounts(review: DerivedReview) {
  const reviewed = new Set(review.rows.map((row) => row.key));
  const unmapped = review.sourceRegisterRows.filter(
    (row) => row.value !== null && !reviewed.has(row.key),
  ).length;
  const invalidRegister = review.sourceRegisterRows.filter((row) => row.value === null).length;
  const invalidPlan = review.planRows.filter((row) => row.value === null).length;
  return {
    sourceRows: review.sourceRegisterRows.length + review.planRows.length,
    registerRows: review.sourceRegisterRows.length,
    planRows: review.planRows.length,
    historyOnly:
      review.rows.filter((row) => row.disposition === "history-only").length +
      unmapped +
      review.planRows.length -
      invalidPlan,
    liveLinked: review.rows.filter((row) => row.disposition === "live-linked").length,
    observationEvidence: review.rows.filter((row) => row.disposition === "observation-evidence")
      .length,
    invalid: invalidRegister + invalidPlan,
  };
}
function sumCents(values: (number | null)[]) {
  if (values.some((value) => value === null)) return null;
  const sum = checkedSum(values.flatMap((value) => (value === null ? [] : [value])));
  return sum.ok ? sum.value : null;
}
function trackingAdjustments(review: DerivedReview) {
  const checks = checkTrackingHistory(review);
  const adjustments = checks.map(({ decision, check }) => {
    const originalCents =
      review.rows.find((row) => row.key === decision.rowKey)?.source.value?.cents ?? null;
    const activeCents = check.status === "unverified" ? originalCents : check.adjustmentCents;
    return { originalCents, activeCents };
  });
  const originalCents = sumCents(adjustments.map((adjustment) => adjustment.originalCents));
  const activeCents = sumCents(adjustments.map((adjustment) => adjustment.activeCents));
  const revisionEffectCents =
    originalCents === null || activeCents === null ? null : sumCents([activeCents, -originalCents]);
  return {
    originalCents,
    activeCents,
    revisionEffectCents,
    unverified: checks.filter(({ check }) => check.status === "unverified").length,
  };
}
export function buildImportReport(review: DerivedReview) {
  const source = total(review.sourceRegisterRows, (value) => value.cents);
  const live = total(
    review.rows.filter((row) => row.disposition === "live-linked").map((row) => row.source),
    (value) => value.cents,
  );
  const planTotal = (key: "assignedCents" | "activityCents" | "availableCents") =>
    total(review.planRows, (value) => value[key]);
  const assigned = planTotal("assignedCents");
  const activity = planTotal("activityCents");
  const available = planTotal("availableCents");
  return {
    ...dispositionCounts(review),
    trackingAdjustments: trackingAdjustments(review),
    sourceNetCents: source.cents,
    sourceNetUnavailableReason: source.reason,
    liveBalanceEffectCents: live.cents,
    liveBalanceUnavailableReason: live.reason,
    planColumnTotals: {
      assignedCents: assigned.cents,
      activityCents: activity.cents,
      availableCents: available.cents,
    },
    planTotalUnavailableReasons: {
      assignedCents: assigned.reason,
      activityCents: activity.reason,
      availableCents: available.reason,
    },
    issues: review.issues,
  };
}
