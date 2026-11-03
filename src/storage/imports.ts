import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { eq } from "drizzle-orm";
import type {
  ImportReceipt,
  ImportStore,
  CheckedObservation,
} from "../application/import-ports.js";
import type {
  ReviewEnvelope,
  ReviewTarget,
  LoadedSources,
  DerivedReview,
} from "../accounts/imports/types.js";
import { deriveReview } from "../accounts/imports/review.js";
import { buildImportReport } from "../accounts/imports/report.js";
import {
  checkTrackingHistory,
  isDiscardedObservationRow,
} from "../accounts/imports/observations.js";
import { openDatabase } from "./database.js";
import { backupDatabase } from "./backup.js";
import { validateMigrationHistory, migrationsFolder } from "./migration-history.js";
import { setupStatusFrom, assertEmptySetup, markSetupComplete } from "./setup.js";
import { accounts } from "./schema/accounts.js";
import { transactions } from "./schema/transactions.js";
import { changes } from "./schema/changes.js";
import { importRuns, importSources } from "./schema/import-sources.js";
import {
  importAccountMappings,
  importRegisterRows,
  importPlanRows,
  importLiveLinks,
} from "./schema/import-history.js";
import { importObservations } from "./schema/import-observations.js";
type Connection = ReturnType<typeof openDatabase>;
type Queries = Pick<Connection["db"], "select" | "insert" | "update" | "all">;
function targetFrom(connection: Connection, path: string): ReviewTarget {
  const history = validateMigrationHistory(connection.sqlite, migrationsFolder);
  if (history.applied !== history.latest)
    throw new Error("Database schema is out of date. Run db:migrate.");
  const marker = setupStatusFrom(connection.db),
    file = statSync(path, { bigint: true });
  return {
    id: marker.targetId,
    path: realpathSync(path),
    schemaVersion: history.applied,
    setupRevision: marker.revision,
    fileIdentity: { device: file.dev.toString(), inode: file.ino.toString() },
  };
}
function sameTarget(actual: ReviewTarget, expected: ReviewTarget, revision: boolean) {
  return (
    actual.id === expected.id &&
    actual.path === expected.path &&
    actual.schemaVersion === expected.schemaVersion &&
    (!revision || actual.setupRevision === expected.setupRevision) &&
    actual.fileIdentity.device === expected.fileIdentity.device &&
    actual.fileIdentity.inode === expected.fileIdentity.inode
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIssue(value: unknown): value is ImportReceipt["report"]["issues"][number] {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.reason === "string" &&
    typeof value.blocking === "boolean" &&
    (value.rowKey === null || typeof value.rowKey === "string")
  );
}
function isReceipt(value: unknown): value is ImportReceipt {
  if (
    !isRecord(value) ||
    !isRecord(value.report) ||
    !isRecord(value.report.planColumnTotals) ||
    !isRecord(value.report.planTotalUnavailableReasons) ||
    !isRecord(value.report.trackingAdjustments)
  )
    return false;
  const report = value.report,
    totals = value.report.planColumnTotals,
    reasons = value.report.planTotalUnavailableReasons,
    adjustments = value.report.trackingAdjustments;
  const countKeys = [
    "sourceRows",
    "registerRows",
    "planRows",
    "historyOnly",
    "liveLinked",
    "observationEvidence",
    "invalid",
  ];
  return (
    typeof value.operationId === "string" &&
    typeof value.importId === "string" &&
    typeof value.reviewId === "string" &&
    Number.isSafeInteger(value.reviewRevision) &&
    typeof value.backupPath === "string" &&
    typeof value.reused === "boolean" &&
    countKeys.every(
      (k) => typeof report[k] === "number" && Number.isSafeInteger(report[k]) && report[k] >= 0,
    ) &&
    [
      report.sourceNetCents,
      report.liveBalanceEffectCents,
      totals.assignedCents,
      totals.activityCents,
      totals.availableCents,
      adjustments.originalCents,
      adjustments.activeCents,
      adjustments.revisionEffectCents,
    ].every((v) => v === null || (typeof v === "number" && Number.isSafeInteger(v))) &&
    [
      report.sourceNetUnavailableReason,
      report.liveBalanceUnavailableReason,
      reasons.assignedCents,
      reasons.activityCents,
      reasons.availableCents,
    ].every((v) => v === null || typeof v === "string") &&
    typeof adjustments.unverified === "number" &&
    Number.isSafeInteger(adjustments.unverified) &&
    adjustments.unverified >= 0 &&
    Array.isArray(report.issues) &&
    report.issues.every(isIssue)
  );
}
export function parseImportReceipt(json: string): ImportReceipt {
  const value: unknown = JSON.parse(json);
  if (!isReceipt(value)) throw new Error("invalid-import-receipt");
  return value;
}
function receiptFrom(db: Queries, review: ReviewEnvelope): ImportReceipt | null {
  const marker = setupStatusFrom(db);
  if (marker.state === "open") return null;
  if (marker.state !== "ynab" || marker.importId !== review.reviewId)
    throw new Error("setup-closed");
  const run = db.select().from(importRuns).where(eq(importRuns.id, marker.importId)).get();
  if (!run || run.reviewId !== review.reviewId || run.reviewRevision !== review.revision)
    throw new Error("setup-closed");
  return { ...parseImportReceipt(run.receiptJson), reused: true };
}
function validateSources(review: ReviewEnvelope, sources: LoadedSources) {
  for (const role of ["register", "plan"] as const) {
    const source = sources[role],
      expected = review.sources[role];
    if (
      source.path !== expected.path ||
      source.bytes.byteLength !== expected.byteLength ||
      source.sha256 !== expected.sha256 ||
      createHash("sha256").update(source.bytes).digest("hex") !== expected.sha256
    )
      throw new Error("changed-source");
  }
}
function validateDerived(
  review: ReviewEnvelope,
  sources: LoadedSources,
  derived: DerivedReview,
  observations: CheckedObservation[],
) {
  const checked = deriveReview(sources, review.decisions, derived.asOfDate);
  if (
    !checked.ready ||
    JSON.stringify(checked) !== JSON.stringify(derived) ||
    JSON.stringify(checkTrackingHistory(checked)) !== JSON.stringify(observations)
  )
    throw new Error("incomplete-review");
}
function writeAccounts(db: Queries, derived: DerivedReview, importId: string, now: string) {
  for (const account of derived.accounts) {
    db.insert(accounts)
      .values({
        id: account.localId,
        name: account.name,
        kind: account.kind,
        currency: "USD",
        openingCents: account.kind === "tracking" ? null : account.openingCents,
        openingDate: account.kind === "tracking" ? null : account.openingDate,
        revision: 1,
        createdAt: now,
      })
      .run();
    const sourceLabel = derived.rows.find((r) => r.accountKey === account.key)?.source.value
      ?.account;
    if (sourceLabel === undefined) throw new Error("incomplete-review");
    db.insert(importAccountMappings)
      .values({
        id: `${importId}:${account.key}`,
        importId: importId,
        sourceLabel,
        groupKey: account.key,
        accountId: account.localId,
        closed: account.closed,
      })
      .run();
  }
}
function writeHistory(
  db: Queries,
  sources: LoadedSources,
  derived: DerivedReview,
  importId: string,
) {
  for (const row of derived.rows) {
    const value = row.source.value,
      account = derived.accounts.find((a) => a.key === row.accountKey);
    if (!value || !account) throw new Error("incomplete-review");
    db.insert(importRegisterRows)
      .values({
        id: row.key,
        importId: importId,
        sourceId: `register:${sources.register.sha256}`,
        ordinal: row.source.ordinal,
        accountId: account.localId,
        occurredOn: value.occurredOn,
        cents: value.cents,
        postedOn: row.postedOn,
        treatment: row.treatment,
        role: row.role,
        disposition: row.disposition,
        originalJson: JSON.stringify(row.source.original),
        normalizedJson: JSON.stringify({
          ...value,
          reviewedPayee: row.payee,
          discardedObservation: isDiscardedObservationRow(derived, row.key),
        }),
      })
      .run();
  }
  for (const row of derived.planRows) {
    const value = row.value;
    if (!value) throw new Error("incomplete-review");
    db.insert(importPlanRows)
      .values({
        id: row.key,
        importId: importId,
        sourceId: `plan:${sources.plan.sha256}`,
        ordinal: row.ordinal,
        month: value.month,
        group: value.categoryGroup,
        category: value.category,
        assignedCents: value.assignedCents,
        activityCents: value.activityCents,
        availableCents: value.availableCents,
        disposition: "history-only",
        originalJson: JSON.stringify(row.original),
        normalizedJson: JSON.stringify(value),
      })
      .run();
  }
}
function writeLive(db: Queries, derived: DerivedReview, now: string) {
  for (const row of derived.rows.filter((r) => r.disposition === "live-linked")) {
    const value = row.source.value,
      account = derived.accounts.find((a) => a.key === row.accountKey);
    if (!value || !account || account.kind === "tracking") throw new Error("incomplete-review");
    const id = `live:${row.key}`;
    db.insert(transactions)
      .values({
        id,
        accountId: account.localId,
        occurredOn: value.occurredOn,
        postedOn: row.postedOn,
        cents: value.cents,
        payee: row.payee,
        memo: value.memo,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(importLiveLinks).values({ sourceRowId: row.key, transactionId: id }).run();
  }
}
function writeObservations(
  db: Queries,
  review: ReviewEnvelope,
  derived: DerivedReview,
  observations: CheckedObservation[],
  importId: string,
) {
  for (const observation of observations) {
    const account = derived.accounts.find((a) => a.key === observation.decision.accountKey),
      row = derived.rows.find((r) => r.key === observation.decision.rowKey);
    if (!account || !row || !row.source.value) throw new Error("incomplete-review");
    db.insert(importObservations)
      .values({
        id: observation.decision.key,
        importId: importId,
        accountId: account.localId,
        sourceRowId: row.key,
        effectiveDate: observation.decision.date,
        observedCents: observation.decision.cents,
        originalAdjustmentCents: row.source.value.cents,
        currentAdjustmentCents: observation.check.adjustmentCents,
        state: observation.check.status,
        metadataJson: JSON.stringify({
          decision: observation.decision,
          check: observation.check,
          decisions: review.decisions,
        }),
      })
      .run();
  }
}
function writeImport(
  db: Queries,
  review: ReviewEnvelope,
  sources: LoadedSources,
  derived: DerivedReview,
  observations: CheckedObservation[],
  now: string,
  receipt: ImportReceipt,
  fault: ((stage: string) => void) | null,
) {
  db.insert(importRuns)
    .values({
      id: receipt.importId,
      reviewId: review.reviewId,
      reviewRevision: review.revision,
      completedAt: now,
      receiptJson: JSON.stringify(receipt),
    })
    .run();
  for (const role of ["register", "plan"] as const) {
    const source = sources[role];
    db.insert(importSources)
      .values({
        id: `${role}:${source.sha256}`,
        importId: receipt.importId,
        role,
        sha256: source.sha256,
        bytes: Buffer.from(source.bytes),
        byteLength: source.bytes.byteLength,
      })
      .run();
  }
  fault?.("sources");
  writeAccounts(db, derived, receipt.importId, now);
  fault?.("accounts");
  writeHistory(db, sources, derived, receipt.importId);
  fault?.("history");
  writeLive(db, derived, now);
  fault?.("live");
  writeObservations(db, review, derived, observations, receipt.importId);
  fault?.("observations");
  db.insert(changes)
    .values({
      id: receipt.operationId,
      operation: "setup.ynab",
      entityId: receipt.importId,
      beforeJson: null,
      afterJson: JSON.stringify({ receipt, decisions: review.decisions }),
      recordedAt: now,
    })
    .run();
  markSetupComplete(db, "ynab", receipt.importId, now);
  fault?.("setup");
}
export function createImportStore(
  path: string,
  fault: ((stage: string) => void) | null = null,
): ImportStore {
  return {
    target: () => {
      const c = openDatabase(path);
      try {
        return c.db.transaction(() => targetFrom(c, path));
      } finally {
        c.sqlite.close();
      }
    },
    eligible: (expected) => {
      const c = openDatabase(path);
      try {
        c.db.transaction((tx) => {
          if (!sameTarget(targetFrom(c, path), expected, true)) throw new Error("stale-target");
          assertEmptySetup(tx);
        });
      } finally {
        c.sqlite.close();
      }
    },
    receipt: (review) => {
      const c = openDatabase(path);
      try {
        return c.db.transaction((tx) => {
          if (!sameTarget(targetFrom(c, path), review.target, false))
            throw new Error("stale-target");
          return receiptFrom(tx, review);
        });
      } finally {
        c.sqlite.close();
      }
    },
    commit: async (review, sources, derived, observations, now) => {
      const c = openDatabase(path);
      try {
        const prior = c.db.transaction((tx) => {
          if (!sameTarget(targetFrom(c, path), review.target, false))
            throw new Error("stale-target");
          return receiptFrom(tx, review);
        });
        if (prior) return prior;
        validateSources(review, sources);
        validateDerived(review, sources, derived, observations);
        if (!sameTarget(targetFrom(c, path), review.target, true)) throw new Error("stale-target");
        c.db.transaction((tx) => assertEmptySetup(tx));
        const backupPath = await backupDatabase(
          c.sqlite,
          `${realpathSync(path)}.backup-import-${randomUUID()}.sqlite`,
        );
        return c.db.transaction(
          (tx) => {
            if (!sameTarget(targetFrom(c, path), review.target, false))
              throw new Error("stale-target");
            const existing = receiptFrom(tx, review);
            if (existing) return existing;
            if (!sameTarget(targetFrom(c, path), review.target, true))
              throw new Error("stale-target");
            assertEmptySetup(tx);
            validateSources(review, sources);
            validateDerived(review, sources, derived, observations);
            const receipt: ImportReceipt = {
              operationId: review.reviewId,
              importId: review.reviewId,
              reviewId: review.reviewId,
              reviewRevision: review.revision,
              backupPath,
              report: buildImportReport(derived),
              reused: false,
            };
            writeImport(tx, review, sources, derived, observations, now, receipt, fault);
            if (!sameTarget(targetFrom(c, path), review.target, false))
              throw new Error("stale-target");
            return receipt;
          },
          { behavior: "immediate" },
        );
      } finally {
        c.sqlite.close();
      }
    },
  };
}
