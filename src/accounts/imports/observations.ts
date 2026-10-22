import { checkTrackingObservation } from "./tracking.js";
import type { DerivedReview, ObservationDecision } from "./types.js";
export function isDiscardedObservationRow(derived: DerivedReview, rowKey: string) {
  return (
    derived.decisions.some((d) => d.tag === "observation-audit" && d.rowKey === rowKey) &&
    !derived.observations.some((o) => o.rowKey === rowKey)
  );
}
export function checkTrackingHistory(derived: DerivedReview) {
  const checks: {
    decision: ObservationDecision;
    check: ReturnType<typeof checkTrackingObservation>;
  }[] = [];
  const adjusted = new Map<string, number>();
  const observations = [...derived.observations].sort((a, b) => a.date.localeCompare(b.date));
  for (const decision of observations) {
    const resolution = derived.decisions.find((d) => d.tag === "resolve" && d.key === decision.key);
    const entries = derived.rows
      .filter(
        (row) =>
          row.accountKey === decision.accountKey && !isDiscardedObservationRow(derived, row.key),
      )
      .map((row) => ({
        key: row.key,
        cents: adjusted.get(row.key) ?? row.source.value?.cents ?? 0,
        postedOn: row.postedOn,
        role: row.role,
        treatment: row.treatment,
      }));
    const check = checkTrackingObservation(
      entries,
      decision,
      resolution?.tag === "resolve" ? resolution.choice : null,
    );
    checks.push({ decision, check });
    if (check.status !== "unverified") adjusted.set(decision.rowKey, check.adjustmentCents);
  }
  return checks;
}
