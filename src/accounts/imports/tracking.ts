import { checkedSum } from "../../lib/money.js";
export type TrackingEntry = {
  key: string;
  cents: number;
  postedOn: string | null;
  role: "transaction" | "adjustment" | "opening";
  treatment: "history" | "pending" | "posted";
};
export type TrackingObservation = { rowKey: string; date: string; cents: number };
export function checkTrackingObservation(
  entries: TrackingEntry[],
  observation: TrackingObservation,
  resolution: "correct-data" | "revise-adjustment" | "defer" | null,
) {
  const adjustment = entries.find((e) => e.key === observation.rowKey && e.role === "adjustment");
  const openings = entries.filter(
    (e) =>
      e.role === "opening" &&
      e.treatment === "posted" &&
      e.postedOn !== null &&
      e.postedOn <= observation.date,
  );
  const opening = openings.length === 1 ? openings[0] : null;
  if (!opening || opening.postedOn === null)
    return {
      status: "unverified" as const,
      reason: "missing-opening" as const,
      adjustmentCents: adjustment?.cents ?? 0,
      recordedCents: null,
      differenceCents: null,
      observedCents: observation.cents,
    };
  if (
    !adjustment ||
    adjustment.treatment !== "posted" ||
    adjustment.postedOn !== observation.date ||
    entries.some((e) => e.treatment !== "pending" && e.postedOn === null)
  )
    return {
      status: "unverified" as const,
      reason: "missing-posting" as const,
      adjustmentCents: adjustment?.cents ?? 0,
      recordedCents: null,
      differenceCents: null,
      observedCents: observation.cents,
    };
  const openingDate = opening.postedOn;
  const eligible = entries.filter(
    (e) =>
      e.treatment === "posted" &&
      e.postedOn !== null &&
      e.postedOn >= openingDate &&
      e.postedOn <= observation.date &&
      e.key !== adjustment.key,
  );
  const base = checkedSum(eligible.map((e) => e.cents));
  if (!base.ok || !Number.isSafeInteger(observation.cents - base.value))
    throw new Error("unsafe-cents");
  const adjustmentCents =
    resolution === "revise-adjustment" ? observation.cents - base.value : adjustment.cents;
  const total = checkedSum([base.value, adjustmentCents]);
  if (!total.ok || !Number.isSafeInteger(observation.cents - total.value))
    throw new Error("unsafe-cents");
  const differenceCents = observation.cents - total.value;
  return {
    status:
      differenceCents === 0 && resolution !== "defer"
        ? ("verified" as const)
        : ("needs-review" as const),
    observedCents: observation.cents,
    recordedCents: total.value,
    differenceCents,
    adjustmentCents,
    reason: null,
  };
}
