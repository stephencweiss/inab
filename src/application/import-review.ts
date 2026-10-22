import { deriveReview, sourceAccounts } from "../accounts/imports/review.js";
import { buildImportReport } from "../accounts/imports/report.js";
import { checkTrackingHistory } from "../accounts/imports/observations.js";
import type { ReviewDecision, ReviewEnvelope, LoadedSources } from "../accounts/imports/types.js";
import type { ImportFiles, ImportStore, ImportRuntime, ReviewChange } from "./import-ports.js";

export function requireReviewSources(
  files: ImportFiles,
  store: ImportStore,
  review: ReviewEnvelope,
) {
  store.eligible(review.target);
  const sources = files.readSources(review.sources.register.path, review.sources.plan.path);
  for (const role of ["register", "plan"] as const) {
    if (
      sources[role].sha256 !== review.sources[role].sha256 ||
      sources[role].bytes.byteLength !== review.sources[role].byteLength
    )
      throw new Error("source-changed");
  }
  return sources;
}
export function viewReview(review: ReviewEnvelope, sources: LoadedSources, today: string) {
  const derived = deriveReview(sources, review.decisions, today);
  return {
    reviewId: review.reviewId,
    revision: review.revision,
    sourceAccounts: sourceAccounts(sources),
    derived,
    report: buildImportReport(derived),
    observations: checkTrackingHistory(derived),
  };
}
function sameDecision(a: ReviewDecision, b: ReviewDecision) {
  if (a.tag !== b.tag) return false;
  if (a.tag === "opening" && b.tag === "opening") return a.accountKey === b.accountKey;
  if (a.tag === "observation" && b.tag === "observation")
    return a.accountKey === b.accountKey && a.date === b.date;
  if ("key" in a && "key" in b) return a.key === b.key;
  return false;
}
function accountChange(
  change: Extract<ReviewChange, { tag: "account" }>,
  review: ReviewEnvelope,
  sources: LoadedSources,
  runtime: ImportRuntime,
): ReviewDecision {
  const original = sourceAccounts(sources).find((a) => a.key === change.sourceAccount);
  const group = review.decisions.find((d) => d.tag === "account" && d.key === change.sourceAccount);
  const sourceKey = original?.key ?? (group?.tag === "account" ? group.sourceAccount : null);
  if (sourceKey === null || !change.name.trim()) throw new Error("invalid-account-mapping");
  const key = change.newGroup ? `group:${runtime.id()}` : change.sourceAccount;
  const before = review.decisions.find((d) => d.tag === "account" && d.key === key);
  return {
    tag: "account",
    key,
    sourceAccount: sourceKey,
    localId: before?.tag === "account" ? before.localId : runtime.id(),
    name: change.name.trim(),
    kind: change.kind,
    closed: change.closed,
  };
}
function observationChange(
  change: Extract<ReviewChange, { tag: "observation" }>,
  review: ReviewEnvelope,
  runtime: ImportRuntime,
) {
  const before = review.decisions.find(
    (d) => d.tag === "observation" && d.accountKey === change.accountKey && d.date === change.date,
  );
  const decision: ReviewDecision = { ...change, key: `observation:${runtime.id()}` };
  if (before?.tag !== "observation") return { decision, history: review.decisions };
  const resolved = review.decisions.find((d) => d.tag === "resolve" && d.key === before.key);
  const audit: ReviewDecision = {
    ...before,
    tag: "observation-audit",
    resolution: resolved?.tag === "resolve" ? resolved.choice : null,
  };
  const history = review.decisions.filter((d) => !(d.tag === "resolve" && d.key === before.key));
  return { decision, history: [...history, audit] };
}
function applyChange(
  change: ReviewChange,
  review: ReviewEnvelope,
  sources: LoadedSources,
  runtime: ImportRuntime,
): ReviewEnvelope {
  const prepared =
    change.tag === "observation"
      ? observationChange(change, review, runtime)
      : {
          decision:
            change.tag === "account" ? accountChange(change, review, sources, runtime) : change,
          history: review.decisions,
        };
  const decision = prepared.decision;
  if (decision.tag === "ack") {
    const view = viewReview(review, sources, runtime.today());
    if (!view.derived.issues.some((i) => i.key === decision.key)) throw new Error("unknown-issue");
  }
  if (
    decision.tag === "resolve" &&
    !review.decisions.some((d) => d.tag === "observation" && d.key === decision.key)
  )
    throw new Error("unknown-observation");
  return {
    ...review,
    revision: review.revision + 1,
    updatedAt: runtime.now(),
    decisions: [...prepared.history.filter((d) => !sameDecision(d, decision)), decision],
  };
}
export function createImportReview(files: ImportFiles, store: ImportStore, runtime: ImportRuntime) {
  function inspect(path: string) {
    const review = files.readReview(path);
    return viewReview(review, requireReviewSources(files, store, review), runtime.today());
  }
  function preview(input: { registerPath: string; planPath: string; reviewPath: string }) {
    const target = store.target();
    store.eligible(target);
    const sources = files.readSources(input.registerPath, input.planPath);
    const sourceRef = (role: "register" | "plan") => ({
      path: sources[role].path,
      sha256: sources[role].sha256,
      byteLength: sources[role].bytes.byteLength,
    });
    const review: ReviewEnvelope = {
      version: 1,
      reviewId: runtime.id(),
      revision: 1,
      createdAt: runtime.now(),
      updatedAt: runtime.now(),
      target,
      sources: { register: sourceRef("register"), plan: sourceRef("plan") },
      decisions: [],
    };
    files.createReview(input.reviewPath, review, [
      target.path,
      sources.register.path,
      sources.plan.path,
    ]);
    return viewReview(review, sources, runtime.today());
  }
  async function change(path: string, expected: number, choice: ReviewChange) {
    const next = await files.updateReview(path, expected, (review) =>
      applyChange(choice, review, requireReviewSources(files, store, review), runtime),
    );
    return viewReview(next, requireReviewSources(files, store, next), runtime.today());
  }
  return { preview, inspect, change };
}
