export type SourceRole = "register" | "plan";
export type CsvRow = { ordinal: number; fields: string[]; raw: string };
export type CsvSource = { headers: string[]; rows: CsvRow[] };
export type CsvResult =
  | { ok: true; value: CsvSource }
  | { ok: false; reason: "invalid-csv" | "unsupported-header" | "input-limit" };
export type SourceStatus = "Uncleared" | "Cleared" | "Reconciled";
export type RegisterRecord = {
  ordinal: number;
  account: string;
  occurredOn: string;
  postedOn: null;
  payee: string;
  memo: string;
  categoryGroupCategory: string;
  categoryGroup: string;
  category: string;
  flag: string;
  outflowCents: number;
  inflowCents: number;
  cents: number;
  sourceStatus: SourceStatus;
};
export type PlanRecord = {
  ordinal: number;
  month: string;
  categoryGroupCategory: string;
  categoryGroup: string;
  category: string;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
};
export type FieldError = { ok: false; reason: string; ordinal: number; column: string };
export type RecordResult<T> = { ok: true; value: T } | FieldError;
