import { requireDatabase } from "./parse.js";
import { resolve } from "node:path";
import { transactionApplication } from "../bootstrap.js";
import type {
  ManualTransaction,
  TransactionFailure,
  TransactionResult,
} from "../application/ports.js";
import { parseMoney } from "../lib/money.js";
import type { TerminalCommand } from "./parse.js";
import { confirmWrite, InvalidInput } from "./prompts.js";
import type { TerminalPrompts } from "./prompts.js";
import { formatCents, renderInspection, renderAffected } from "./render.js";
function unwrap<T>(result: TransactionResult<T>) {
  if (result.ok) return result.value;
  const reason = result.reason;
  process.exitCode = 2;
  if (reason === "account-unavailable" || reason === "transaction-unavailable")
    process.exitCode = 3;
  if (reason === "stale-version") process.exitCode = 4;
  const messages: Partial<Record<TransactionFailure, string>> = {
    "future-date": "future-date: Scheduled activity is not supported in Slice 1.",
    "tracking-register":
      "tracking-register: Tracking transactions and registers are not supported in Slice 1.",
  };
  throw new InvalidInput(messages[reason] ?? reason);
}
function render(entry: ManualTransaction, status = "cleared") {
  const clearance = entry.postedOn === null ? "uncleared" : `${status} ${entry.postedOn}`;
  return `${entry.id} | revision ${entry.revision} | ${entry.occurredOn} | ${clearance} | USD ${formatCents(entry.cents)} | ${entry.payee} | ${entry.memo}`;
}
function output(json: boolean, result: object, text: string) {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${text}\n`);
}
function previewFor(command: TerminalCommand, app: ReturnType<typeof transactionApplication>) {
  const id = command.id ?? "";
  const revision = command.expectedVersion ?? 0;
  if (command.action === "transaction-clear")
    return unwrap(app.previewClear(id, revision, command.postedOn ?? ""));
  if (command.action === "transaction-unclear") return unwrap(app.previewUnclear(id, revision));
  const amount = parseMoney(command.opening);
  if (!amount.ok) throw new InvalidInput(amount.reason);
  const input = {
    occurredOn: command.date ?? "",
    cents: amount.value,
    payee: command.payee ?? "",
    memo: command.memo ?? "",
  };
  if (command.action === "transaction-edit") return unwrap(app.previewEdit(id, revision, input));
  return unwrap(app.previewAdd(command.accountId ?? "", { ...input, postedOn: command.postedOn }));
}
export async function executeTransaction(command: TerminalCommand, prompts: TerminalPrompts) {
  const app = transactionApplication(requireDatabase(command));
  if (command.action === "register") {
    const result = unwrap(app.register(command.id ?? ""));
    const entries = result.entries;
    output(
      command.json,
      { ok: true, ...result, entries },
      `${renderInspection(result.account, result.balances)}\n${result.entries.map((entry) => render(entry, entry.clearance)).join("\n")}`,
    );
    return;
  }
  const preview = previewFor(command, app);
  if (!command.json || !command.confirm)
    process.stderr.write(
      `Database target: ${resolve(requireDatabase(command))}\nAccount ID: ${preview.account.id} | revision ${preview.account.revision}\nOperation ID: ${preview.operationId}\nBefore: ${preview.before === null ? "none" : render(preview.before)}\nAfter: ${render(preview.after)}\n${renderAffected(preview.affectedReconciliations)}`,
    );
  if (!(await confirmWrite(command, prompts))) {
    output(
      command.json,
      { ok: true, canceled: true, operationId: null, transaction: null },
      "Canceled",
    );
    return;
  }
  const result = unwrap(app.commit(preview));
  output(
    command.json,
    { ok: true, ...result },
    `Saved ${render(result.transaction)}\nOperation ID: ${result.operationId}`,
  );
}
