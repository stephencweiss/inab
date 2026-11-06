import { parseBudgetFacts } from "../budget/parse.js";
import { calculateBudget } from "../budget/calculate.js";
import {
  validateActivation,
  accountBoundary,
  currentAccountBalances,
} from "./budget-activation.js";
import type { BudgetFacts, BudgetEvent } from "../budget/types.js";
import type {
  BudgetCommand,
  BudgetSnapshot,
  BudgetResult,
  BudgetCoverage,
} from "./budget-ports.js";

function category(facts: BudgetFacts, id: string) {
  return facts.categories.find((c) => c.id === id && !c.archived);
}
function assigned(facts: BudgetFacts, month: string, id: string) {
  return facts.assignments.find((a) => a.month === month && a.categoryId === id)?.amountCents ?? 0;
}
function setAssigned(facts: BudgetFacts, month: string, categoryId: string, amountCents: number) {
  return {
    ...facts,
    assignments: [
      ...facts.assignments.filter((a) => a.month !== month || a.categoryId !== categoryId),
      { month, categoryId, amountCents },
    ],
  };
}
function changeCategory(
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "category-change" }>,
) {
  if (!facts.categories.some((c) => c.id === command.id))
    return { ok: false as const, reason: "category-unavailable" };
  if (!Number.isSafeInteger(command.position) || command.position < 0)
    return { ok: false as const, reason: "invalid-position" };
  const categories = facts.categories.map((c) =>
    c.id === command.id
      ? { ...c, name: command.name.trim(), groupId: command.groupId, archived: command.archived }
      : c,
  );
  const selected = categories.find((c) => c.id === command.id);
  const other = categories.filter((c) => c.id !== command.id);
  if (selected) other.splice(Math.min(command.position, other.length), 0, selected);
  return { ok: true as const, value: { ...facts, categories: other } };
}
function allocate(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "allocate" }>,
) {
  const tx = snapshot.transactions.find((t) => t.id === command.transactionId);
  if (!tx) return { ok: false as const, reason: "transaction-unavailable" };
  if (tx.revision !== command.expectedTransactionVersion)
    return { ok: false as const, reason: "stale-version" };
  if (snapshot.state?.coverage.includedTransactionIds.includes(tx.id))
    return { ok: false as const, reason: "opening-amendment-required" };
  if (facts.events.some((e) => e.kind === "transfer" && e.sourceId.split("|").includes(tx.id)))
    return { ok: false as const, reason: "linked-transfer" };
  if (
    command.allocation.kind === "categories" &&
    command.allocation.lines.some((l) => !category(facts, l.categoryId))
  )
    return { ok: false as const, reason: "category-unavailable" };
  const before = facts.events.find((e) => e.id === tx.id);
  const event: BudgetEvent = {
    kind: "transaction",
    id: tx.id,
    sourceId: before?.sourceId ?? `live:${tx.id}`,
    date: before?.date ?? tx.occurredOn,
    order: before?.order ?? facts.events.length,
    accountId: tx.accountId,
    amountCents: tx.cents,
    allocation: command.allocation,
  };
  return {
    ok: true as const,
    value: { ...facts, events: [...facts.events.filter((e) => e.id !== tx.id), event] },
  };
}
function transfer(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "transfer" }>,
  id: string,
  legs: { from: string; to: string },
) {
  const from = snapshot.accounts.find((a) => a.id === command.fromAccountId),
    to = snapshot.accounts.find((a) => a.id === command.toAccountId);
  if (!from || !to) return { ok: false as const, reason: "account-unavailable" };
  if (from.revision !== command.expectedFromVersion || to.revision !== command.expectedToVersion)
    return { ok: false as const, reason: "stale-version" };
  const linked = [command.fromTransactionId, command.toTransactionId].filter((t) => t !== null);
  for (const transactionId of linked) {
    if (
      facts.events.some(
        (e) => e.kind === "transfer" && e.sourceId.split("|").includes(transactionId),
      )
    )
      return { ok: false as const, reason: "linked-transfer" };
  }
  const event: BudgetEvent = {
    kind: "transfer",
    id,
    sourceId: `transfer|${legs.from}|${legs.to}`,
    date: command.date,
    order: facts.events.length,
    fromAccountId: from.id,
    toAccountId: to.id,
    amountCents: command.amountCents,
    categoryId: command.categoryId,
  };
  return {
    ok: true as const,
    value: { ...facts, events: [...facts.events.filter((e) => !linked.includes(e.id)), event] },
  };
}
function editTransfer(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "transfer-edit" | "transfer-unlink" }>,
) {
  if (command.expectedActivityVersion !== snapshot.state?.revision)
    return { ok: false as const, reason: "stale-version" };
  const event = facts.events.find((e) => e.id === command.id);
  if (!event || event.kind !== "transfer")
    return { ok: false as const, reason: "activity-unavailable" };
  if (!event.sourceId.startsWith("transfer|"))
    return { ok: false as const, reason: "opening-amendment-required" };
  const events = facts.events.filter((e) => e.id !== event.id);
  if (command.kind === "transfer-edit")
    events.push({
      ...event,
      date: command.date,
      amountCents: command.amountCents,
      categoryId: command.categoryId,
    });
  else
    for (const tx of snapshot.transactions.filter((t) => event.sourceId.split("|").includes(t.id)))
      events.push({
        kind: "transaction",
        id: tx.id,
        sourceId: `live:${tx.id}`,
        date: tx.occurredOn,
        order: events.length,
        accountId: tx.accountId,
        amountCents: tx.cents,
        allocation: { kind: "unallocated" },
      });
  return { ok: true as const, value: { ...facts, events } };
}
function move(
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "move" }>,
): BudgetResult<BudgetFacts> {
  if (
    command.fromCategoryId === command.toCategoryId ||
    !category(facts, command.fromCategoryId) ||
    !category(facts, command.toCategoryId) ||
    !Number.isSafeInteger(command.amountCents) ||
    command.amountCents <= 0
  )
    return { ok: false, reason: "invalid-move" };
  const next = setAssigned(
    facts,
    command.month,
    command.fromCategoryId,
    assigned(facts, command.month, command.fromCategoryId) - command.amountCents,
  );
  return {
    ok: true,
    value: setAssigned(
      next,
      command.month,
      command.toCategoryId,
      assigned(facts, command.month, command.toCategoryId) + command.amountCents,
    ),
  };
}
function addCategory(
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "category-add" }>,
): BudgetResult<BudgetFacts> {
  if (facts.categories.some((c) => c.id === command.id))
    return { ok: false, reason: "duplicate-category" };
  return {
    ok: true,
    value: {
      ...facts,
      categories: [
        ...facts.categories,
        {
          id: command.id,
          groupId: command.groupId,
          name: command.name.trim(),
          archived: false,
          cardAccountId: null,
        },
      ],
      opening: {
        ...facts.opening,
        categories: [
          ...facts.opening.categories,
          { categoryId: command.id, availableCents: 0, evidence: "Created after activation" },
        ],
      },
    },
  };
}
function correctHistorical(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  command: Extract<BudgetCommand, { kind: "historical-correct" }>,
): BudgetResult<BudgetFacts> {
  if (command.expectedActivityVersion !== snapshot.state?.revision)
    return { ok: false, reason: "stale-version" };
  const old = facts.events.find((e) => e.id === command.event.id);
  if (!old) return { ok: false, reason: "activity-unavailable" };
  if (
    snapshot.transactions.some((t) => t.id === old.id) ||
    old.kind !== command.event.kind ||
    old.sourceId !== command.event.sourceId
  )
    return { ok: false, reason: "live-correction-required" };
  if (command.event.date < `${facts.startMonth}-01`)
    return { ok: false, reason: "opening-amendment-required" };
  const after = {
    ...facts,
    events: facts.events.map((e) => (e.id === old.id ? command.event : e)),
  };
  if (
    snapshot.state &&
    (accountBoundary(snapshot, after, snapshot.state.coverage) ||
      currentAccountBalances(snapshot, after))
  )
    return { ok: false, reason: "opening-amendment-required" };
  return { ok: true, value: after };
}
function mutate(
  snapshot: BudgetSnapshot,
  facts: BudgetFacts,
  command: BudgetCommand,
  id: string,
  legs: { from: string; to: string } | null,
): BudgetResult<BudgetFacts> {
  switch (command.kind) {
    case "assign":
      return category(facts, command.categoryId)
        ? {
            ok: true,
            value: setAssigned(facts, command.month, command.categoryId, command.amountCents),
          }
        : { ok: false, reason: "category-unavailable" };
    case "move":
      return move(facts, command);
    case "category-add":
      return addCategory(facts, command);
    case "category-change":
      return changeCategory(facts, command);
    case "allocate":
      return allocate(snapshot, facts, command);
    case "historical-correct":
      return correctHistorical(snapshot, facts, command);
    case "transfer":
      return legs
        ? transfer(snapshot, facts, command, id, legs)
        : { ok: false, reason: "invalid-transfer" };
    case "transfer-edit":
    case "transfer-unlink":
      return editTransfer(snapshot, facts, command);
    default:
      return { ok: false, reason: "invalid-budget-command" };
  }
}
function horizon(facts: BudgetFacts, today: string) {
  return facts.assignments.reduce((end, a) => (a.month > end ? a.month : end), today.slice(0, 7));
}
function fundingCheck(before: BudgetFacts, after: BudgetFacts, today: string): string | null {
  const end = horizon(after, today),
    old = calculateBudget(before, end),
    next = calculateBudget(after, end);
  if (!old.ok) return old.reason;
  if (!next.ok) return next.reason;
  if (old.months.some((month) => !month.complete)) return "unallocated-activity";
  for (const month of next.months) {
    const previous = old.months.find((m) => m.month === month.month);
    if (
      month.fundingDeficitCents > (previous?.fundingDeficitCents ?? 0) ||
      month.readyToAssignCents < Math.min(previous?.readyToAssignCents ?? 0, 0)
    )
      return "insufficient-funds";
    for (const c of month.categories) {
      const available =
        previous?.categories.find((p) => p.categoryId === c.categoryId)?.availableCents ?? 0;
      if (c.availableCents < Math.min(available, 0)) return "insufficient-category-funds";
    }
  }
  return null;
}
function activation(
  snapshot: BudgetSnapshot,
  command: Extract<BudgetCommand, { kind: "activate" | "amend-opening" }>,
  today: string,
): BudgetResult<{ facts: BudgetFacts; coverage: BudgetCoverage }> {
  if (command.kind === "activate" && snapshot.state !== null)
    return { ok: false, reason: "budget-active" };
  if (command.kind === "amend-opening" && snapshot.state === null)
    return { ok: false, reason: "budget-inactive" };
  const parsed = parseBudgetFacts(command.facts);
  if (!parsed.ok) return parsed;
  const valid = validateActivation(snapshot, parsed.value, command.coverage, today);
  if (!valid.ok) return valid;
  const calculated = calculateBudget(parsed.value, horizon(parsed.value, today));
  if (!calculated.ok) return calculated;
  if (calculated.months.some((m) => !m.complete))
    return { ok: false, reason: "unallocated-activity" };
  return { ok: true, value: { facts: parsed.value, coverage: command.coverage } };
}
function checkedMutation(
  before: BudgetFacts,
  after: BudgetFacts,
  command: BudgetCommand,
  today: string,
) {
  const parsed = parseBudgetFacts(after);
  if (!parsed.ok) return parsed;
  if (parsed.value.events.some((e) => e.date > today))
    return { ok: false as const, reason: "future-activity" };
  const calculated = calculateBudget(parsed.value, horizon(parsed.value, today));
  if (!calculated.ok) return calculated;
  if (command.kind === "assign" || command.kind === "move") {
    const reason = fundingCheck(before, parsed.value, today);
    if (reason) return { ok: false as const, reason };
  }
  return parsed;
}
export function applyBudgetCommand(
  snapshot: BudgetSnapshot,
  command: BudgetCommand,
  today: string,
  id: string,
  legs: { from: string; to: string } | null,
): BudgetResult<{ facts: BudgetFacts; coverage: BudgetCoverage }> {
  if (command.kind === "activate" || command.kind === "amend-opening")
    return activation(snapshot, command, today);
  const state = snapshot.state;
  if (state === null) return { ok: false, reason: "budget-inactive" };
  if (state.status !== "active") return { ok: false, reason: "opening-needs-review" };
  const result = mutate(snapshot, state.facts, command, id, legs);
  if (!result.ok) return result;
  const parsed = checkedMutation(state.facts, result.value, command, today);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { facts: parsed.value, coverage: state.coverage } };
}
