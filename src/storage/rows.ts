import type { RegisterEntry } from "../accounts/types.js";
import type { StoredAccount } from "../application/ports.js";
import { parseNewAccount } from "../application/accounts.js";
import { parseDate } from "../lib/date.js";
import { validateCents } from "../lib/money.js";
export function parseInteger(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result)) {
    throw new Error("Invalid database integer");
  }
  return result;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseMigrationRow(value: unknown) {
  if (!isRecord(value) || typeof value.hash !== "string") {
    throw new Error("Invalid migration history");
  }
  return { hash: value.hash, createdAt: parseInteger(value.created_at) };
}

function parseTimestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    throw new Error("Invalid database timestamp");
  const time = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString() !== canonical)
    throw new Error("Invalid database timestamp");
  return value;
}

export function parseAccountRow(value: unknown): StoredAccount {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.createdAt !== "string"
  )
    throw new Error("Invalid account row");
  const parsed = parseNewAccount(value);
  if (!parsed.ok) throw new Error("Invalid account row");
  const revision = parseInteger(value.revision);
  if (revision < 1) throw new Error("Invalid account revision");
  return { ...parsed.value, id: value.id, revision, createdAt: parseTimestamp(value.createdAt) };
}
export function parseTransactionRow(value: unknown): RegisterEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.accountId !== "string" ||
    typeof value.occurredOn !== "string" ||
    !parseDate(value.occurredOn).ok ||
    (value.postedOn !== null &&
      (typeof value.postedOn !== "string" || !parseDate(value.postedOn).ok))
  )
    throw new Error("Invalid transaction row");
  const cents = parseInteger(value.cents);
  if (!validateCents(cents, "transaction").ok) throw new Error("Invalid transaction cents");
  return {
    id: value.id,
    accountId: value.accountId,
    cents,
    occurredOn: value.occurredOn,
    postedOn: value.postedOn,
  };
}

export function parseManualTransactionRow(
  value: unknown,
): import("../application/ports.js").ManualTransaction {
  const entry = parseTransactionRow(value);
  if (
    !isRecord(value) ||
    !entry.id ||
    !entry.accountId ||
    typeof value.payee !== "string" ||
    !value.payee.trim() ||
    typeof value.memo !== "string"
  )
    throw new Error("Invalid transaction metadata");
  const revision = parseInteger(value.revision);
  if (revision < 1) throw new Error("Invalid transaction revision");
  return {
    ...entry,
    payee: value.payee,
    memo: value.memo,
    revision,
    createdAt: parseTimestamp(value.createdAt),
    updatedAt: parseTimestamp(value.updatedAt),
  };
}
