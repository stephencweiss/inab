import type { BudgetCommand, BudgetSnapshot } from "../application/budget-ports.js";
import type { BudgetAllocation } from "../budget/types.js";
import { parseBudgetFacts } from "../budget/parse.js";
import { parseMoney } from "../lib/money.js";
import { budgetFlag, budgetInteger } from "./budget-parse.js";
import type { BudgetTerminalCommand } from "./budget-parse.js";
function amount(value: string) {
  const parsed = parseMoney(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}
function allocation(command: BudgetTerminalCommand, snapshot: BudgetSnapshot): BudgetAllocation {
  const modes = ["--category", "--line", "--income", "--unallocated"].filter((k) =>
    command.flags.has(k),
  );
  if (modes.length !== 1) throw new Error("allocation-choice-required");
  if (command.flags.has("--income")) return { kind: "income" };
  if (command.flags.has("--unallocated")) return { kind: "unallocated" };
  const tx = snapshot.transactions.find((t) => t.id === command.selector);
  if (!tx) throw new Error("transaction-unavailable");
  const single = command.flags.get("--category");
  if (single) return { kind: "categories", lines: [{ categoryId: single, amountCents: tx.cents }] };
  return {
    kind: "categories",
    lines: command.lines.map((line) => {
      const index = line.lastIndexOf(":");
      if (index < 1) throw new Error("invalid-allocation-line");
      return { categoryId: line.slice(0, index), amountCents: amount(line.slice(index + 1)) };
    }),
  };
}
function historical(command: BudgetTerminalCommand, snapshot: BudgetSnapshot): BudgetCommand {
  if (!snapshot.state) throw new Error("budget-inactive");
  const raw: unknown = JSON.parse(budgetFlag(command, "--decision"));
  const parsed = parseBudgetFacts({ ...snapshot.state.facts, events: [raw] });
  if (!parsed.ok) throw new Error(parsed.reason);
  const event = parsed.value.events[0];
  if (!event || event.id !== command.selector) throw new Error("activity-id-mismatch");
  return {
    kind: "historical-correct",
    event,
    expectedActivityVersion: budgetInteger(budgetFlag(command, "--expected-activity-version"), 1),
  };
}
function changeCategory(command: BudgetTerminalCommand, snapshot: BudgetSnapshot): BudgetCommand {
  const facts = snapshot.state?.facts,
    old = facts?.categories.find((c) => c.id === command.selector);
  if (!old || !facts) throw new Error("category-unavailable");
  let archived = old.archived;
  if (command.action === "category archive") archived = true;
  if (command.action === "category unarchive") archived = false;
  return {
    kind: "category-change",
    id: old.id,
    name: command.action === "category rename" ? budgetFlag(command, "--name") : old.name,
    groupId: command.flags.get("--group") ?? old.groupId,
    archived,
    position:
      command.action === "category reorder"
        ? budgetInteger(budgetFlag(command, "--position"))
        : facts.categories.findIndex((c) => c.id === old.id),
  };
}
export function budgetWriteCommand(
  command: BudgetTerminalCommand,
  snapshot: BudgetSnapshot,
  id: string,
): BudgetCommand {
  const flag = (name: string) => budgetFlag(command, name),
    revision = (name: string) => budgetInteger(flag(name), 1);
  switch (command.action) {
    case "assign":
      return {
        kind: "assign",
        month: flag("--month"),
        categoryId: flag("--category"),
        amountCents: amount(flag("--amount")),
      };
    case "move":
      return {
        kind: "move",
        month: flag("--month"),
        fromCategoryId: flag("--from"),
        toCategoryId: flag("--to"),
        amountCents: amount(flag("--amount")),
      };
    case "category add":
      return {
        kind: "category-add",
        id: command.flags.get("--id") ?? id,
        groupId: flag("--group"),
        name: flag("--name"),
      };
    case "category rename":
    case "category archive":
    case "category unarchive":
    case "category reorder":
      return changeCategory(command, snapshot);
    case "allocate":
      return {
        kind: "allocate",
        transactionId: command.selector ?? "",
        expectedTransactionVersion: revision("--expected-transaction-version"),
        allocation: allocation(command, snapshot),
      };
    case "activity correct":
      return historical(command, snapshot);
    case "transfer add":
    case "transfer link":
      return transferCommand(command);
    case "transfer edit":
      return {
        kind: "transfer-edit",
        id: command.selector ?? "",
        date: flag("--date"),
        amountCents: amount(flag("--amount")),
        categoryId: command.flags.get("--category") ?? null,
        expectedActivityVersion: revision("--expected-activity-version"),
      };
    case "transfer unlink":
      return {
        kind: "transfer-unlink",
        id: command.selector ?? "",
        expectedActivityVersion: revision("--expected-activity-version"),
      };
    default:
      throw new Error("invalid-budget-command");
  }
}

function transferCommand(command: BudgetTerminalCommand): BudgetCommand {
  const flag = (name: string) => budgetFlag(command, name),
    revision = (name: string) => budgetInteger(flag(name), 1);
  if (
    command.action === "transfer link" &&
    (!command.flags.has("--from-transaction") || !command.flags.has("--to-transaction"))
  )
    throw new Error("transfer-legs-required");
  return {
    kind: "transfer",
    fromAccountId: flag("--from"),
    toAccountId: flag("--to"),
    date: flag("--date"),
    amountCents: amount(flag("--amount")),
    categoryId: command.flags.get("--category") ?? null,
    expectedFromVersion: revision("--expected-from-version"),
    expectedToVersion: revision("--expected-to-version"),
    fromTransactionId: command.flags.get("--from-transaction") ?? null,
    toTransactionId: command.flags.get("--to-transaction") ?? null,
  };
}
