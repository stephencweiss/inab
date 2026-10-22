import type { PlanRecord, RegisterRecord } from "./source-types.js";
export type LoadedRow<T> = {
  key: string;
  ordinal: number;
  raw: string;
  original: Record<string, string>;
  value: T | null;
  error: string | null;
};
export type LoadedFile<T> = {
  path: string;
  sha256: string;
  bytes: Uint8Array;
  rows: LoadedRow<T>[];
};
export type LoadedSources = { register: LoadedFile<RegisterRecord>; plan: LoadedFile<PlanRecord> };
export type AccountDecision = {
  tag: "account";
  key: string;
  sourceAccount: string;
  localId: string;
  name: string;
  kind: "cash" | "credit" | "tracking";
  closed: boolean;
};
export type RowDecision = {
  tag: "row";
  key: string;
  accountKey: string | null;
  treatment: "history" | "pending" | "posted";
  postedOn: string | null;
  payee: string | null;
  role: "transaction" | "adjustment" | "opening";
};
export type ObservationDecision = {
  tag: "observation";
  key: string;
  accountKey: string;
  rowKey: string;
  date: string;
  cents: number;
};
export type ObservationAuditDecision = Omit<ObservationDecision, "tag"> & {
  tag: "observation-audit";
  resolution: "correct-data" | "revise-adjustment" | "defer" | null;
};
export type ReviewDecision =
  | AccountDecision
  | RowDecision
  | ObservationDecision
  | ObservationAuditDecision
  | { tag: "opening"; accountKey: string; date: string; cents: number }
  | { tag: "resolve"; key: string; choice: "correct-data" | "revise-adjustment" | "defer" }
  | { tag: "ack"; key: string };
export type ReviewTarget = {
  id: string;
  path: string;
  schemaVersion: number;
  setupRevision: number;
  fileIdentity: { device: string; inode: string };
};
export type ReviewSource = { path: string; sha256: string; byteLength: number };
export type ReviewEnvelope = {
  version: 1;
  reviewId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  target: ReviewTarget;
  sources: { register: ReviewSource; plan: ReviewSource };
  decisions: ReviewDecision[];
};
export type ReviewIssue = { key: string; reason: string; blocking: boolean; rowKey: string | null };
export type ReviewedAccount = AccountDecision & {
  openingDate: string | null;
  openingCents: number | null;
};
export type ReviewedRow = {
  key: string;
  source: LoadedRow<RegisterRecord>;
  accountKey: string;
  treatment: RowDecision["treatment"];
  postedOn: string | null;
  payee: string;
  role: RowDecision["role"];
  disposition: "history-only" | "live-linked" | "observation-evidence";
};
export type DerivedReview = {
  asOfDate: string;
  sourceRegisterRows: LoadedRow<RegisterRecord>[];
  ready: boolean;
  accounts: ReviewedAccount[];
  rows: ReviewedRow[];
  planRows: LoadedRow<PlanRecord>[];
  observations: ObservationDecision[];
  issues: ReviewIssue[];
  decisions: ReviewDecision[];
};
