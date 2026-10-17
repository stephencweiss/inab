import { executeTransaction } from "./transactions.js";
import { resolve } from "node:path";
import { accountApplication, initializeDatabase, localToday } from "../bootstrap.js";
import type { AccountFailure, AccountResult } from "../application/ports.js";
import { parseNewAccount } from "../application/accounts.js";
import { parseMoney } from "../lib/money.js";
import { parseArguments } from "./parse.js";
import type { TerminalCommand } from "./parse.js";
import {
  completeCommand,
  confirmWrite,
  InvalidInput,
  PromptCancelled,
  terminalPrompts,
} from "./prompts.js";
import { renderAccount, renderInspection, renderPreview } from "./render.js";
const help = `INAB — manual accounts

Usage: inab --db PATH COMMAND [--json]

Available:
  init --confirm
  account add --name NAME --kind cash|credit --opening SIGNED_USD --as-of YYYY-MM-DD --confirm
  account add --name NAME --kind tracking --confirm
  transaction add --account ID --date DATE --amount SIGNED_USD --payee TEXT [--memo TEXT] [--posted-on DATE] --confirm
  transaction edit ID --date DATE --amount SIGNED_USD --payee TEXT --memo TEXT --expected-version N --confirm
  transaction clear ID --posted-on DATE --expected-version N --confirm
  transaction unclear ID --expected-version N --confirm
  register ID
  account list
  account show ID
  account rename ID --name NAME --expected-version N --confirm
  account opening ID --amount SIGNED_USD --as-of YYYY-MM-DD --expected-version N --confirm

Use --currency USD on account add. IDs select accounts; names do not.
Cash inflow is positive; cash outflow and credit debt are negative.
In a terminal, the opening date prompt shows today's local date. Scripts require --as-of.
Writes show a preview. Enter cancel to stop a prompt. Scripts require --confirm.

These manual-account commands are planned and not available yet:
  reconcile ID
  reconciliation list
  snapshot add|correct|list
  backup --to NEW_PATH
  restore --from BACKUP_PATH --to NEW_PATH
`;
function failureCode(reason: AccountFailure) {
  if (reason === "account-unavailable") return 3;
  if (reason === "stale-version") return 4;
  return 2;
}
function unwrap<T>(result: AccountResult<T>) {
  if (result.ok) return result.value;
  process.exitCode = failureCode(result.reason);
  throw new InvalidInput(result.reason);
}
function output(json: boolean, value: object, text: string) {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${text}\n`);
}
function createPreview(command: TerminalCommand, app: ReturnType<typeof accountApplication>) {
  if (command.action === "rename")
    return unwrap(
      app.previewRename(command.id ?? "", command.expectedVersion ?? 0, command.name ?? ""),
    );
  const amount =
    command.opening === null ? { ok: true as const, value: null } : parseMoney(command.opening);
  if (!amount.ok) throw new InvalidInput(amount.reason);
  if (command.action === "opening") {
    if (amount.value === null) throw new InvalidInput("Opening amount is required");
    return unwrap(
      app.previewOpening(
        command.id ?? "",
        command.expectedVersion ?? 0,
        amount.value,
        command.date ?? "",
      ),
    );
  }
  const input = unwrap(
    parseNewAccount({
      name: command.name,
      kind: command.kind,
      currency: command.currency,
      openingCents: amount.value,
      openingDate: command.date,
    }),
  );
  return unwrap(app.previewAdd(input));
}
async function execute(command: TerminalCommand, prompts: ReturnType<typeof terminalPrompts>) {
  if (command.action === "init") {
    if (!command.confirm) throw new InvalidInput("Init requires --confirm");
    if (!command.json) process.stderr.write(`Init target: ${command.database}\n`);
    const result = await initializeDatabase(command.database);
    output(command.json, result, `Initialized database: ${result.database}`);
    return;
  }
  if (command.action.startsWith("transaction-") || command.action === "register") {
    await executeTransaction(command, prompts);
    return;
  }
  const app = accountApplication(command.database);
  if (command.action === "list") {
    const accounts = app.list();
    output(
      command.json,
      { ok: true, accounts },
      accounts.map(renderAccount).join("\n") || "No accounts",
    );
    return;
  }
  if (command.action === "show") {
    const inspected = unwrap(app.inspect(command.id ?? ""));
    output(
      command.json,
      { ok: true, ...inspected },
      renderInspection(inspected.account, inspected.balances),
    );
    return;
  }
  const preview = createPreview(command, app);
  if (!command.json || !command.confirm)
    process.stderr.write(renderPreview(resolve(command.database), preview));
  if (!(await confirmWrite(command, prompts))) {
    output(
      command.json,
      { ok: true, canceled: true, operationId: null, account: null },
      "Canceled",
    );
    return;
  }
  const result = unwrap(app.commit(preview));
  output(
    command.json,
    { ok: true, ...result },
    `Saved ${renderAccount(result.account)}\nOperation ID: ${result.operationId}`,
  );
}
function reportFailure(error: Error | object, json: boolean) {
  if (error instanceof PromptCancelled) {
    output(json, { ok: true, canceled: true, operationId: null, account: null }, "Canceled");
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : "Storage failure"}\n`);
  process.exitCode ||= error instanceof InvalidInput ? 2 : 1;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help);
    return;
  }
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("0.0.0\n");
    return;
  }
  const prompts = terminalPrompts();
  let json = args.includes("--json");
  try {
    let command;
    try {
      command = parseArguments(args);
    } catch (error) {
      throw new InvalidInput(
        `${error instanceof Error ? error.message : "Invalid command"}. Use --help for command status.`,
      );
    }
    json = command.json;
    const completed = await completeCommand(command, prompts, localToday());
    await execute(completed, prompts);
  } catch (error) {
    reportFailure(error instanceof Error ? error : {}, json);
  } finally {
    prompts.close();
  }
}
await main();
