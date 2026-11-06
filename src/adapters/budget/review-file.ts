import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { assertOutsideCheckout, readBoundedFile } from "./files.js";

import type {
  BudgetCoverage,
  BudgetPreview,
  BudgetCommand,
  BudgetResult,
} from "../../application/budget-ports.js";
type BudgetFacts = Extract<BudgetCommand, { kind: "activate" }>["facts"];
export type BudgetReview = {
  format: 1;
  id: string;
  revision: number;
  targetPath: string;
  targetId: string;
  targetDevice: string;
  targetInode: string;
  baseline: string;
  expectedBudgetRevision: number;
  answers: string[];
  month: string;
  mode: "activate" | "amend-opening";
  facts: BudgetFacts | null;
  coverage: BudgetCoverage | null;
  preview: BudgetPreview | null;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function parseBudgetCoverage(value: unknown): BudgetCoverage {
  if (
    !isRecord(value) ||
    !isText(value.throughDate) ||
    !isText(value.evidence) ||
    !Array.isArray(value.includedTransactionIds) ||
    !value.includedTransactionIds.every(isText) ||
    !Array.isArray(value.postedBridgeEventIds) ||
    !value.postedBridgeEventIds.every(isText)
  )
    throw new Error("invalid-coverage");
  return {
    throughDate: value.throughDate,
    evidence: value.evidence,
    includedTransactionIds: value.includedTransactionIds,
    postedBridgeEventIds: value.postedBridgeEventIds,
  };
}
export function createBudgetReviewFiles(parseFacts: (value: object) => BudgetResult<BudgetFacts>) {
  function parseBudgetFacts(value: unknown): BudgetResult<BudgetFacts> {
    if (!isRecord(value)) return { ok: false, reason: "invalid-budget-facts" };
    return parseFacts(value);
  }
  function isPreview(value: unknown): value is BudgetPreview {
    if (
      !isRecord(value) ||
      !isRecord(value.command) ||
      !["activate", "amend-opening"].includes(String(value.command.kind)) ||
      !isText(value.baseline) ||
      !isInteger(value.expectedRevision) ||
      !isText(value.operationId) ||
      !isText(value.recordedAt) ||
      value.transferLegIds !== null
    )
      return false;
    if (!parseBudgetFacts(value.after).ok || !parseBudgetFacts(value.command.facts).ok)
      return false;
    try {
      parseBudgetCoverage(value.coverage);
      parseBudgetCoverage(value.command.coverage);
      return true;
    } catch {
      return false;
    }
  }
  function isAnswers(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
  function isTargetIdentity(value: Record<string, unknown>): value is Record<string, unknown> & {
    targetId: string;
    targetDevice: string;
    targetInode: string;
  } {
    return isText(value.targetId) && isText(value.targetDevice) && isText(value.targetInode);
  }
  function parseReviewFacts(value: unknown) {
    if (value === null) return null;
    const facts = parseBudgetFacts(value);
    if (!facts.ok) throw new Error(facts.reason);
    return facts.value;
  }
  function parseReviewPreview(value: unknown) {
    if (value === null) return null;
    if (!isPreview(value)) throw new Error("invalid-review");
    return value;
  }
  function parseBudgetReview(value: unknown): BudgetReview {
    if (
      !isRecord(value) ||
      !isAnswers(value.answers) ||
      value.format !== 1 ||
      !isText(value.id) ||
      !isInteger(value.revision) ||
      value.revision < 1 ||
      !isText(value.targetPath) ||
      !isTargetIdentity(value) ||
      !isText(value.baseline) ||
      !isInteger(value.expectedBudgetRevision) ||
      !isText(value.month) ||
      !["activate", "amend-opening"].includes(String(value.mode))
    )
      throw new Error("invalid-review");
    const facts = parseReviewFacts(value.facts);
    const preview = parseReviewPreview(value.preview);
    return {
      answers: value.answers,
      format: 1,
      id: value.id,
      revision: value.revision,
      targetPath: value.targetPath,
      targetId: value.targetId,
      targetDevice: value.targetDevice,
      targetInode: value.targetInode,
      baseline: value.baseline,
      expectedBudgetRevision: value.expectedBudgetRevision,
      month: value.month,
      mode: value.mode === "activate" ? "activate" : "amend-opening",
      facts,
      coverage: value.coverage === null ? null : parseBudgetCoverage(value.coverage),
      preview,
    };
  }
  function readBudgetReview(path: string): BudgetReview {
    const file = readBoundedFile(path);
    try {
      return parseBudgetReview(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)),
      );
    } catch {
      throw new Error("invalid-review");
    }
  }
  function destination(path: string) {
    const absolute = resolve(path);
    let parent = dirname(absolute);
    while (!existsSync(parent)) parent = dirname(parent);
    assertOutsideCheckout(join(realpathSync(parent), absolute.slice(parent.length)));
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    const canonical = join(realpathSync(dirname(absolute)), basename(absolute));
    assertOutsideCheckout(canonical);
    try {
      if (lstatSync(canonical).isSymbolicLink()) throw new Error("invalid-path");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return canonical;
  }
  function assertNoAlias(path: string, forbidden: string) {
    if (resolve(forbidden) === path) throw new Error("review-alias");
    if (!existsSync(forbidden)) return;
    if (realpathSync(forbidden) === path) throw new Error("review-alias");
    if (existsSync(path)) {
      const a = statSync(path, { bigint: true }),
        b = statSync(forbidden, { bigint: true });
      if (a.dev === b.dev && a.ino === b.ino) throw new Error("review-alias");
    }
  }
  function writePrivate(path: string, value: BudgetReview) {
    const text = JSON.stringify(parseBudgetReview(value));
    if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw new Error("input-limit");
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } catch (error) {
      unlinkSync(path);
      throw error;
    } finally {
      closeSync(fd);
    }
  }
  function createBudgetReview(path: string, value: BudgetReview) {
    const target = destination(path);
    assertNoAlias(target, value.targetPath);
    writePrivate(target, value);
  }
  /** Holds an exclusive private lock across asynchronous work. Existing locks are never stolen. */
  async function withBudgetReviewLock<T>(path: string, work: () => Promise<T> | T): Promise<T> {
    const target = destination(path),
      lock = `${target}.lock`;
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch {
      throw new Error("review-locked");
    }
    const owned = fstatSync(fd, { bigint: true });
    try {
      return await work();
    } finally {
      closeSync(fd);
      if (existsSync(lock)) {
        const current = lstatSync(lock, { bigint: true });
        if (current.dev === owned.dev && current.ino === owned.ino) unlinkSync(lock);
      }
    }
  }
  /** Caller holds the review lock. Saves use an atomic replacement in the same directory. */
  function writeBudgetReview(path: string, value: BudgetReview) {
    const target = destination(path);
    assertNoAlias(target, value.targetPath);
    const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
    try {
      writePrivate(temp, value);
      renameSync(temp, target);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
  async function updateBudgetReview(
    path: string,
    expectedRevision: number,
    mutate: (value: BudgetReview) => BudgetReview,
  ) {
    return withBudgetReviewLock(path, () => {
      const current = readBudgetReview(path);
      if (current.revision !== expectedRevision) throw new Error("stale-review");
      const next = parseBudgetReview(mutate(current));
      if (next.revision !== current.revision + 1) throw new Error("invalid-review");
      writeBudgetReview(path, next);
      return next;
    });
  }

  return {
    createBudgetReview,
    readBudgetReview,
    updateBudgetReview,
    withBudgetReviewLock,
    writeBudgetReview,
  };
}
