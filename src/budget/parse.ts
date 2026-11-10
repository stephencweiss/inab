import { validateAllocations } from "./allocations.js";
import { parseDate } from "../lib/date.js";
import type {
  AllocationLine,
  BudgetAllocation,
  BudgetAssignment,
  BudgetCategory,
  BudgetEvent,
  BudgetFacts,
  BudgetOpening,
  BudgetResult,
  OpeningAccount,
  OpeningCategory,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
export function parseMonth(value: unknown): BudgetResult<string> {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) && parseDate(`${value}-01`).ok
    ? { ok: true, value }
    : { ok: false, reason: "invalid-month" };
}
function isCategory(value: unknown): value is BudgetCategory {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.groupId) &&
    isText(value.name) &&
    typeof value.archived === "boolean" &&
    (value.cardAccountId === null || isText(value.cardAccountId))
  );
}
function isOpeningAccount(value: unknown): value is OpeningAccount {
  return (
    isRecord(value) &&
    isText(value.accountId) &&
    (value.kind === "cash" || value.kind === "credit") &&
    isCents(value.balanceCents) &&
    typeof value.closed === "boolean" &&
    isText(value.evidence)
  );
}
function isOpeningCategory(value: unknown): value is OpeningCategory {
  return (
    isRecord(value) &&
    isText(value.categoryId) &&
    isCents(value.availableCents) &&
    isText(value.evidence)
  );
}
function isOpening(value: unknown): value is BudgetOpening {
  return (
    isRecord(value) &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isOpeningAccount) &&
    Array.isArray(value.categories) &&
    value.categories.every(isOpeningCategory) &&
    isCents(value.readyToAssignCents) &&
    isText(value.evidence) &&
    typeof value.deficitAcknowledged === "boolean"
  );
}
function isAssignment(value: unknown): value is BudgetAssignment {
  return (
    isRecord(value) &&
    parseMonth(value.month).ok &&
    isText(value.categoryId) &&
    isCents(value.amountCents)
  );
}
function isLine(value: unknown): value is AllocationLine {
  return isRecord(value) && isText(value.categoryId) && isCents(value.amountCents);
}
function isAllocation(value: unknown): value is BudgetAllocation {
  return (
    isRecord(value) &&
    (value.kind === "income" ||
      value.kind === "unallocated" ||
      (value.kind === "categories" &&
        Array.isArray(value.lines) &&
        value.lines.length > 0 &&
        value.lines.every(isLine)))
  );
}
function isEvent(value: unknown): value is BudgetEvent {
  if (
    !isRecord(value) ||
    !isText(value.id) ||
    !isText(value.sourceId) ||
    !parseDate(value.date).ok ||
    !isCents(value.order) ||
    value.order < 0 ||
    !isCents(value.amountCents) ||
    value.amountCents === 0
  )
    return false;
  if (value.kind === "transaction")
    return isText(value.accountId) && isAllocation(value.allocation);
  return (
    value.kind === "transfer" &&
    isText(value.fromAccountId) &&
    isText(value.toAccountId) &&
    (value.categoryId === null || isText(value.categoryId)) &&
    value.amountCents > 0
  );
}
function isFacts(value: unknown): value is BudgetFacts {
  return (
    isRecord(value) &&
    parseMonth(value.startMonth).ok &&
    value.currency === "USD" &&
    isOpening(value.opening) &&
    Array.isArray(value.categories) &&
    value.categories.every(isCategory) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isAssignment) &&
    Array.isArray(value.events) &&
    value.events.every(isEvent)
  );
}
function hasDuplicates(values: readonly string[]) {
  return new Set(values).size !== values.length;
}
export function parseBudgetFacts(input: unknown): BudgetResult<BudgetFacts> {
  if (!isFacts(input)) return { ok: false, reason: "invalid-budget-facts" };
  if (
    hasDuplicates(input.categories.map((c) => c.id)) ||
    hasDuplicates(input.opening.accounts.map((a) => a.accountId)) ||
    hasDuplicates(input.opening.categories.map((c) => c.categoryId)) ||
    hasDuplicates(input.events.map((e) => e.id)) ||
    hasDuplicates(input.events.map((e) => e.sourceId)) ||
    hasDuplicates(input.assignments.map((a) => `${a.month}:${a.categoryId}`))
  )
    return { ok: false, reason: "duplicate-budget-fact" };
  const categories = new Set(input.categories.map((c) => c.id));
  const accounts = new Set(input.opening.accounts.map((a) => a.accountId));
  const links = input.categories.flatMap((c) =>
    c.cardAccountId === null ? [] : [c.cardAccountId],
  );
  if (
    hasDuplicates(links) ||
    links.some(
      (id) => !input.opening.accounts.some((a) => a.accountId === id && a.kind === "credit"),
    )
  )
    return { ok: false, reason: "invalid-card-category" };
  if (
    input.opening.categories.some((c) => !categories.has(c.categoryId)) ||
    input.categories.some((c) => !input.opening.categories.some((o) => o.categoryId === c.id)) ||
    input.assignments.some((a) => !categories.has(a.categoryId) || a.month < input.startMonth)
  )
    return { ok: false, reason: "invalid-category-fact" };
  for (const event of input.events) {
    const result = validateEvent(event, input.startMonth, accounts, categories);
    if (!result.ok) return result;
  }
  return { ok: true, value: input };
}
function validateEvent(
  event: BudgetEvent,
  startMonth: string,
  accounts: Set<string>,
  categories: Set<string>,
): BudgetResult<BudgetEvent> {
  if (event.date.slice(0, 7) < startMonth) return { ok: false, reason: "event-before-opening" };
  if (event.kind === "transfer") return { ok: true, value: event };
  if (!accounts.has(event.accountId)) return { ok: false, reason: "invalid-event-reference" };
  if (event.allocation.kind === "categories") {
    const allocation = validateAllocations(event.amountCents, event.allocation.lines);
    if (!allocation.ok) return allocation;
    if (event.allocation.lines.some((line) => !categories.has(line.categoryId)))
      return { ok: false, reason: "invalid-event-reference" };
  }
  return { ok: true, value: event };
}
