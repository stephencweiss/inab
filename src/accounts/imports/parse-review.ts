import { isUtcTimestamp, parseDate as parseCalendarDate } from "../../lib/date.js";
import type { ReviewDecision, ReviewEnvelope, ReviewSource, ReviewTarget } from "./types.js";

function invalid(): never {
  throw new Error("invalid-review");
}
function parseObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid();
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key)))
    return invalid();
  return Object.fromEntries(Object.entries(input));
}
function parseText(input: unknown): string {
  return typeof input === "string" && input.length > 0 && !input.includes("\0") ? input : invalid();
}
function parseNullableText(input: unknown): string | null {
  if (input === null) return null;
  return typeof input === "string" && !input.includes("\0") ? input : invalid();
}
function parseInteger(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) ? input : invalid();
}
function parsePositive(input: unknown): number {
  const value = parseInteger(input);
  return value > 0 ? value : invalid();
}
function parsePath(input: unknown): string {
  const value = parseText(input);
  const parts = value.slice(1).split("/");
  return value.startsWith("/") &&
    parts.every((part) => part !== "" && part !== "." && part !== "..")
    ? value
    : invalid();
}
function parseDate(input: unknown): string {
  const result = parseCalendarDate(input);
  return result.ok ? result.value : invalid();
}
function parseTimestamp(input: unknown): string {
  return isUtcTimestamp(input) ? input : invalid();
}
function parseIdentityNumber(input: unknown): string {
  const value = parseText(input);
  return /^(0|[1-9]\d*)$/.test(value) ? value : invalid();
}
function parseSource(input: unknown): ReviewSource {
  const value = parseObject(input, ["path", "sha256", "byteLength"]);
  const sha256 = parseText(value.sha256);
  const byteLength = parseInteger(value.byteLength);
  if (!/^[a-f0-9]{64}$/.test(sha256) || byteLength < 0 || byteLength > 64 * 1024 * 1024)
    return invalid();
  return { path: parsePath(value.path), sha256, byteLength };
}
function parseTarget(input: unknown): ReviewTarget {
  const value = parseObject(input, [
    "id",
    "path",
    "schemaVersion",
    "setupRevision",
    "fileIdentity",
  ]);
  const identity = parseObject(value.fileIdentity, ["device", "inode"]);
  return {
    id: parseText(value.id),
    path: parsePath(value.path),
    schemaVersion: parsePositive(value.schemaVersion),
    setupRevision: parsePositive(value.setupRevision),
    fileIdentity: {
      device: parseIdentityNumber(identity.device),
      inode: parseIdentityNumber(identity.inode),
    },
  };
}
function parseAccount(input: unknown): ReviewDecision {
  const value = parseObject(input, [
    "tag",
    "key",
    "sourceAccount",
    "localId",
    "name",
    "kind",
    "closed",
  ]);
  if (value.kind !== "cash" && value.kind !== "credit" && value.kind !== "tracking")
    return invalid();
  if (typeof value.closed !== "boolean") return invalid();
  return {
    tag: "account",
    key: parseText(value.key),
    sourceAccount: parseText(value.sourceAccount),
    localId: parseText(value.localId),
    name: parseText(value.name),
    kind: value.kind,
    closed: value.closed,
  };
}
function parseRow(input: unknown): ReviewDecision {
  const value = parseObject(input, [
    "tag",
    "key",
    "accountKey",
    "treatment",
    "postedOn",
    "payee",
    "role",
  ]);
  if (
    value.treatment !== "history" &&
    value.treatment !== "pending" &&
    value.treatment !== "posted"
  )
    return invalid();
  if (value.role !== "transaction" && value.role !== "adjustment" && value.role !== "opening")
    return invalid();
  return {
    tag: "row",
    key: parseText(value.key),
    accountKey: value.accountKey === null ? null : parseText(value.accountKey),
    treatment: value.treatment,
    postedOn: value.postedOn === null ? null : parseDate(value.postedOn),
    payee: parseNullableText(value.payee),
    role: value.role,
  };
}
function parseObservationAudit(input: unknown): ReviewDecision {
  const value = parseObject(input, [
    "tag",
    "key",
    "accountKey",
    "rowKey",
    "date",
    "cents",
    "resolution",
  ]);
  if (
    value.resolution !== null &&
    value.resolution !== "correct-data" &&
    value.resolution !== "revise-adjustment" &&
    value.resolution !== "defer"
  )
    return invalid();
  return {
    tag: "observation-audit",
    key: parseText(value.key),
    accountKey: parseText(value.accountKey),
    rowKey: parseText(value.rowKey),
    date: parseDate(value.date),
    cents: parseInteger(value.cents),
    resolution: value.resolution,
  };
}
function parseDecision(input: unknown): ReviewDecision {
  if (typeof input !== "object" || input === null || !("tag" in input)) return invalid();
  if (input.tag === "account") return parseAccount(input);
  if (input.tag === "row") return parseRow(input);
  if (input.tag === "observation-audit") return parseObservationAudit(input);
  if (input.tag === "opening") {
    const value = parseObject(input, ["tag", "accountKey", "date", "cents"]);
    return {
      tag: "opening",
      accountKey: parseText(value.accountKey),
      date: parseDate(value.date),
      cents: parseInteger(value.cents),
    };
  }
  if (input.tag === "observation") {
    const value = parseObject(input, ["tag", "key", "accountKey", "rowKey", "date", "cents"]);
    return {
      tag: "observation",
      key: parseText(value.key),
      accountKey: parseText(value.accountKey),
      rowKey: parseText(value.rowKey),
      date: parseDate(value.date),
      cents: parseInteger(value.cents),
    };
  }
  if (input.tag === "ack") {
    const value = parseObject(input, ["tag", "key"]);
    return { tag: "ack", key: parseText(value.key) };
  }
  if (input.tag === "resolve") {
    const value = parseObject(input, ["tag", "key", "choice"]);
    if (
      value.choice !== "correct-data" &&
      value.choice !== "revise-adjustment" &&
      value.choice !== "defer"
    )
      return invalid();
    return { tag: "resolve", key: parseText(value.key), choice: value.choice };
  }
  return invalid();
}
export function parseReviewEnvelope(input: unknown): ReviewEnvelope {
  try {
    const value = parseObject(input, [
      "version",
      "reviewId",
      "revision",
      "createdAt",
      "updatedAt",
      "target",
      "sources",
      "decisions",
    ]);
    if (value.version !== 1 || !Array.isArray(value.decisions)) return invalid();
    const sources = parseObject(value.sources, ["register", "plan"]);
    const decisions: ReviewDecision[] = [];
    for (const decision of value.decisions) decisions.push(parseDecision(decision));
    return {
      version: 1,
      reviewId: parseText(value.reviewId),
      revision: parsePositive(value.revision),
      createdAt: parseTimestamp(value.createdAt),
      updatedAt: parseTimestamp(value.updatedAt),
      target: parseTarget(value.target),
      sources: { register: parseSource(sources.register), plan: parseSource(sources.plan) },
      decisions,
    };
  } catch {
    return invalid();
  }
}
