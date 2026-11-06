import { isBudgetArguments } from "./budget-parse.js";
import { runBudgetArguments, budgetHelp } from "./budget.js";
import { cliVersion, terminalWelcome } from "./welcome.js";
import { isSetupArguments } from "./setup-parse.js";
import { runSetupArguments } from "./setup.js";
import { RecoveryStorageError } from "../application/backup.js";
import { executeRecovery } from "./backup.js";
import { executeSnapshot } from "./snapshots.js";
import { executeReconciliation } from "./reconciliation.js";
import { executeTransaction } from "./transactions.js";
import { resolve } from "node:path";
import {
  accountApplication,
  initializeDatabase,
  localToday,
  setupApplication,
} from "../bootstrap.js";
import type { AccountFailure, AccountResult } from "../application/ports.js";
import { parseNewAccount } from "../application/accounts.js";
import { parseMoney } from "../lib/money.js";
import { parseArguments, requireDatabase } from "./parse.js";
import type { TerminalCommand } from "./parse.js";
import {
  completeCommand,
  confirmWrite,
  InvalidInput,
  PromptCancelled,
  terminalPrompts,
} from "./prompts.js";
import { renderAccount, renderAccountSummary, renderInspection, renderPreview } from "./render.js";
const help = `INAB — manual accounts

Usage: inab --db PATH COMMAND [--json]

Available:
  setup status
  setup fresh --confirm
  setup migrate preview --register FILE --plan FILE --review NEW_FILE
  setup migrate review --review FILE [--interactive|-i | --json]
  setup migrate account SOURCE --review FILE --name NAME --kind cash|credit|tracking --closed yes|no [--new-group] --expected-review N
  setup migrate opening GROUP --review FILE --as-of DATE --balance USD --expected-review N
  setup migrate row ROW --review FILE --treatment history|pending|posted [--account GROUP] [--posted-on DATE] [--payee TEXT] [--role transaction|adjustment|opening] --expected-review N
  setup migrate observation GROUP --review FILE --row ROW --as-of DATE --balance USD --expected-review N
  setup migrate resolve ISSUE --review FILE --choice correct-data|revise-adjustment|defer --expected-review N
  setup migrate acknowledge ISSUE --review FILE --expected-review N
  setup migrate commit --review FILE --expected-review N --confirm
  import history accounts
  import history register ACCOUNT_ID [--limit N] [--offset N]
  import history plan --month YYYY-MM [--limit N] [--offset N]
  import history report IMPORT_ID
  backup --to NEW_PATH --confirm
  restore --from BACKUP_PATH --to NEW_PATH --confirm (without --db)
  init --confirm
  account add --name NAME --kind cash|credit --opening SIGNED_USD --as-of YYYY-MM-DD --confirm
  account add --name NAME --kind tracking --confirm
  transaction add --account ID --date DATE --amount SIGNED_USD --payee TEXT [--memo TEXT] [--posted-on DATE] --confirm
  transaction edit ID --date DATE --amount SIGNED_USD --payee TEXT --memo TEXT --expected-version N --confirm
  transaction clear ID --posted-on DATE --expected-version N --confirm
  transaction unclear ID --expected-version N --confirm
  register ID
  reconcile ID --as-of DATE --bank-balance SIGNED_USD [--confirm]
  snapshot add --account ID --as-of DATE --balance SIGNED_USD --confirm
  snapshot correct ID --balance SIGNED_USD --expected-version N --confirm
  snapshot list --account ID
  reconciliation list --account ID
  account list
  account show ID
  account rename ID --name NAME --expected-version N --confirm
  account opening ID --amount SIGNED_USD --as-of YYYY-MM-DD --expected-version N --confirm

Use --currency USD on account add. IDs select accounts; names do not.
Cash inflow is positive; cash outflow and credit debt are negative.
In a terminal, the opening date prompt shows today's local date. Scripts require --as-of.
Writes show a preview. Enter a or abandon to leave a prompt. Confirmations accept y/yes or n/no, regardless of case. Scripts require --confirm.

Migration review starts a guide in a terminal. --interactive (or -i) requires a terminal.
Use --json for review data without prompts. Do not combine --interactive and --json.

Backup uses --db PATH. Restore uses --from BACKUP_PATH and does not accept --db.
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
function showSetupConsequence(command: TerminalCommand) {
  if (
    command.action === "add" &&
    !command.json &&
    setupApplication(requireDatabase(command)).status().state === "open"
  )
    process.stderr.write(
      "Creating this account starts fresh and closes YNAB migration for this database.\n",
    );
}
async function execute(command: TerminalCommand, prompts: ReturnType<typeof terminalPrompts>) {
  if (command.action === "backup" || command.action === "restore") {
    await executeRecovery(command, prompts);
    return;
  }
  if (command.action === "init") {
    if (!command.confirm) throw new InvalidInput("Init requires --confirm");
    if (!command.json) process.stderr.write(`Init target: ${command.database}\n`);
    const result = await initializeDatabase(requireDatabase(command));
    output(command.json, result, `Initialized database: ${result.database}`);
    return;
  }
  if (command.action.startsWith("snapshot-")) {
    await executeSnapshot(command, prompts);
    return;
  }
  if (command.action === "reconcile" || command.action === "reconciliation-list") {
    await executeReconciliation(command, prompts);
    return;
  }
  if (command.action.startsWith("transaction-") || command.action === "register") {
    await executeTransaction(command, prompts);
    return;
  }
  const app = accountApplication(requireDatabase(command));
  if (command.action === "list") {
    const accounts = app.list();
    output(
      command.json,
      { ok: true, accounts },
      accounts.map((account) => renderAccountSummary(account, account.latestSnapshot)).join("\n") ||
        "No accounts",
    );
    return;
  }
  if (command.action === "show") {
    const inspected = unwrap(app.inspect(command.id ?? ""));
    output(
      command.json,
      { ok: true, ...inspected },
      renderInspection(inspected.account, inspected.balances, inspected.latestSnapshot),
    );
    return;
  }
  const preview = createPreview(command, app);
  showSetupConsequence(command);
  if (!command.json || !command.confirm)
    process.stderr.write(renderPreview(resolve(requireDatabase(command)), preview));
  if (!(await confirmWrite(command, prompts))) {
    output(
      command.json,
      { ok: true, canceled: true, operationId: null, account: null },
      "Abandoned",
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
    output(json, { ok: true, canceled: true, operationId: null, account: null }, "Abandoned");
    return;
  }
  if (json && error instanceof RecoveryStorageError) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, reason: "storage-failure", operationId: error.operationId, destination: error.destination, message: error.message })}\n`,
    );
  } else process.stderr.write(`${error instanceof Error ? error.message : "Storage failure"}\n`);
  process.exitCode ||= error instanceof InvalidInput ? 2 : 1;
}
async function main() {
  const args = process.argv.slice(2);
  process.stderr.write(terminalWelcome(Boolean(process.stdin.isTTY && process.stderr.isTTY), args));
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(help + budgetHelp);
    return;
  }
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${cliVersion}\n`);
    return;
  }
  const prompts = terminalPrompts();
  if (isBudgetArguments(args)) {
    try {
      await runBudgetArguments(args, prompts);
    } finally {
      prompts.close();
    }
    return;
  }
  if (isSetupArguments(args)) {
    try {
      await runSetupArguments(args, prompts);
    } finally {
      prompts.close();
    }
    return;
  }
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
