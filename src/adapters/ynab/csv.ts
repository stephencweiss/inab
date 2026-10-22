import { parse } from "csv-parse/sync";
import type { CsvResult, CsvRow, SourceRole } from "../../accounts/imports/source-types.js";

export const registerHeaders = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
];
export const planHeaders = [
  "Month",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Assigned",
  "Activity",
  "Available",
];
const fileLimit = 64 * 1024 * 1024;
const recordLimit = 1024 * 1024;

function parseRawRecord(input: unknown): { fields: string[]; raw: string } {
  if (
    typeof input !== "object" ||
    input === null ||
    !("record" in input) ||
    !("raw" in input) ||
    !Array.isArray(input.record) ||
    !input.record.every((field) => typeof field === "string") ||
    typeof input.raw !== "string"
  )
    throw new Error("invalid-csv");
  const fields: string[] = [];
  for (const field of input.record) {
    if (typeof field !== "string") throw new Error("invalid-csv");
    fields.push(field);
  }
  return { fields, raw: input.raw };
}

/** Limits are 64 MiB per file, 1 MiB per record, and 250,000 data records. */
export function parseYnabCsv(role: SourceRole, bytes: Uint8Array): CsvResult {
  if (bytes.byteLength > fileLimit) return { ok: false, reason: "input-limit" };
  let headers: string[] | null = null;
  const rows: CsvRow[] = [];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parse(text, {
      bom: true,
      cast: false,
      skip_empty_lines: true,
      raw: true,
      info: true,
      max_record_size: recordLimit,
      on_record: function parseRecord(input: unknown) {
        const record = parseRawRecord(input);
        if (Buffer.byteLength(record.raw, "utf8") > recordLimit || rows.length >= 250000)
          throw new Error("input-limit");
        if (headers === null) {
          const expected = role === "register" ? registerHeaders : planHeaders;
          if (
            record.fields.length !== expected.length ||
            new Set(record.fields).size !== expected.length ||
            record.fields.some((name) => !expected.includes(name))
          )
            throw new Error("unsupported-header");
          headers = record.fields;
        } else rows.push({ ordinal: rows.length + 1, fields: record.fields, raw: record.raw });
        return null;
      },
    });
    if (headers === null) return { ok: false, reason: "unsupported-header" };
    return { ok: true, value: { headers, rows } };
  } catch (error) {
    if (error instanceof Error && error.message === "unsupported-header")
      return { ok: false, reason: "unsupported-header" };
    if (
      error instanceof Error &&
      (error.message === "input-limit" || ("code" in error && error.code === "CSV_MAX_RECORD_SIZE"))
    )
      return { ok: false, reason: "input-limit" };
    return { ok: false, reason: "invalid-csv" };
  }
}
