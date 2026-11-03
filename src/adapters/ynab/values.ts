import { parseDate } from "../../lib/date.js";
import { parseMoney } from "../../lib/money.js";
import type {
  CsvRow,
  FieldError,
  PlanRecord,
  RecordResult,
  RegisterRecord,
  SourceStatus,
} from "../../accounts/imports/source-types.js";

type ValueResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseYnabAmount(input: string): ValueResult<number> {
  if (!/^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input))
    return { ok: false, reason: "invalid-money" };
  return parseMoney(input.replace("$", "").replaceAll(",", ""));
}

export function parseYnabDate(input: string): ValueResult<string> {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(input)) return { ok: false, reason: "invalid-date" };
  return parseDate(`${input.slice(6)}-${input.slice(0, 2)}-${input.slice(3, 5)}`);
}

export function parseYnabMonth(input: string): ValueResult<string> {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  if (!/^[A-Z][a-z]{2} \d{4}$/.test(input)) return { ok: false, reason: "invalid-month" };
  const month = months.indexOf(input.slice(0, 3)) + 1;
  const date = parseDate(`${input.slice(4)}-${String(month).padStart(2, "0")}-01`);
  return date.ok
    ? { ok: true, value: date.value.slice(0, 7) }
    : { ok: false, reason: "invalid-month" };
}

function field(row: CsvRow, headers: string[], column: string) {
  return row.fields[headers.indexOf(column)] ?? "";
}
function failure(row: CsvRow, column: string, reason: string): FieldError {
  return { ok: false, ordinal: row.ordinal, column, reason };
}
function parseStatus(input: string): ValueResult<SourceStatus> {
  if (input === "Uncleared" || input === "Cleared" || input === "Reconciled")
    return { ok: true, value: input };
  return { ok: false, reason: "unsupported-clearing-status" };
}
function parseMovement(input: string): ValueResult<number> {
  const amount = parseYnabAmount(input);
  return amount.ok && amount.value < 0 ? { ok: false, reason: "negative-movement" } : amount;
}

export function parseRegisterRecord(row: CsvRow, headers: string[]): RecordResult<RegisterRecord> {
  const account = field(row, headers, "Account");
  if (account.length === 0) return failure(row, "Account", "missing-account");
  const date = parseYnabDate(field(row, headers, "Date"));
  if (!date.ok) return failure(row, "Date", date.reason);
  const outflow = parseMovement(field(row, headers, "Outflow"));
  if (!outflow.ok) return failure(row, "Outflow", outflow.reason);
  const inflow = parseMovement(field(row, headers, "Inflow"));
  if (!inflow.ok) return failure(row, "Inflow", inflow.reason);
  if (outflow.value !== 0 && inflow.value !== 0) return failure(row, "Inflow", "both-movements");
  const status = parseStatus(field(row, headers, "Cleared"));
  if (!status.ok) return failure(row, "Cleared", status.reason);
  return {
    ok: true,
    value: {
      ordinal: row.ordinal,
      account,
      occurredOn: date.value,
      postedOn: null,
      payee: field(row, headers, "Payee"),
      memo: field(row, headers, "Memo"),
      categoryGroupCategory: field(row, headers, "Category Group/Category"),
      categoryGroup: field(row, headers, "Category Group"),
      category: field(row, headers, "Category"),
      flag: field(row, headers, "Flag"),
      outflowCents: outflow.value,
      inflowCents: inflow.value,
      cents: inflow.value - outflow.value,
      sourceStatus: status.value,
    },
  };
}

export function parsePlanRecord(row: CsvRow, headers: string[]): RecordResult<PlanRecord> {
  const month = parseYnabMonth(field(row, headers, "Month"));
  if (!month.ok) return failure(row, "Month", month.reason);
  const assigned = parseYnabAmount(field(row, headers, "Assigned"));
  if (!assigned.ok) return failure(row, "Assigned", assigned.reason);
  const activity = parseYnabAmount(field(row, headers, "Activity"));
  if (!activity.ok) return failure(row, "Activity", activity.reason);
  const available = parseYnabAmount(field(row, headers, "Available"));
  if (!available.ok) return failure(row, "Available", available.reason);
  return {
    ok: true,
    value: {
      ordinal: row.ordinal,
      month: month.value,
      categoryGroupCategory: field(row, headers, "Category Group/Category"),
      categoryGroup: field(row, headers, "Category Group"),
      category: field(row, headers, "Category"),
      assignedCents: assigned.value,
      activityCents: activity.value,
      availableCents: available.value,
    },
  };
}
