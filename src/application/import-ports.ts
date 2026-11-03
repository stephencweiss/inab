import type {
  LoadedSources,
  ReviewEnvelope,
  ReviewTarget,
  ReviewDecision,
  RowDecision,
  ObservationDecision,
  DerivedReview,
} from "../accounts/imports/types.js";
import type { buildImportReport } from "../accounts/imports/report.js";
import type { checkTrackingObservation } from "../accounts/imports/tracking.js";
export type ReviewChange =
  | Exclude<
      ReviewDecision,
      { tag: "account" } | { tag: "observation" } | { tag: "observation-audit" }
    >
  | {
      tag: "account";
      sourceAccount: string;
      name: string;
      kind: "cash" | "credit" | "tracking";
      closed: boolean;
      newGroup: boolean;
    }
  | Omit<ObservationDecision, "key">;
export type ImportFiles = {
  readSources: (registerPath: string, planPath: string) => LoadedSources;
  readReview: (path: string) => ReviewEnvelope;
  createReview: (path: string, review: ReviewEnvelope, forbidden: string[]) => void;
  writeReview: (path: string, review: ReviewEnvelope) => void;
  updateReview: (
    path: string,
    expected: number,
    mutate: (review: ReviewEnvelope) => ReviewEnvelope,
  ) => Promise<ReviewEnvelope>;
  withReviewLock: <T>(path: string, work: () => Promise<T> | T) => Promise<T>;
};
export type CheckedObservation = {
  decision: ObservationDecision;
  check: ReturnType<typeof checkTrackingObservation>;
};
export type ImportReceipt = {
  operationId: string;
  importId: string;
  reviewId: string;
  reviewRevision: number;
  backupPath: string;
  report: ReturnType<typeof buildImportReport>;
  reused: boolean;
};
export type ImportStore = {
  target: () => ReviewTarget;
  eligible: (target: ReviewTarget) => void;
  receipt: (review: ReviewEnvelope) => ImportReceipt | null;
  commit: (
    review: ReviewEnvelope,
    sources: LoadedSources,
    derived: DerivedReview,
    observations: CheckedObservation[],
    now: string,
  ) => Promise<ImportReceipt>;
};
export type ImportRuntime = { id: () => string; now: () => string; today: () => string };
export type RowChange = RowDecision;
export class ImportStorageError extends Error {
  constructor(
    readonly operationId: string,
    cause: object,
  ) {
    super(`Import failed. Inspect operation ${operationId} before retrying.`, { cause });
  }
}
