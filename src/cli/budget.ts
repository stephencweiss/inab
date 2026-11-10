import { writeJson } from "./json.js";
import { budgetPreviewSummary } from "./budget-preview.js";
import { renderBudgetReport } from "./budget-render.js";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { budgetApplication, localToday } from "../bootstrap.js";
import { parseMonth } from "../budget/parse.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
import { confirm } from "./migration-questions.js";
import { parseBudgetArguments, budgetFlag, budgetInteger } from "./budget-parse.js";
import type { BudgetTerminalCommand } from "./budget-parse.js";
import { executeBudgetActivation, budgetValue } from "./budget-activation.js";
import type { BudgetSnapshot } from "../application/budget-ports.js";
import { budgetWriteCommand } from "./budget-commands.js";
export const budgetHelp = `
Budget:
  budget status
  budget activation start --month YYYY-MM --review NEW_FILE [--amend]
  budget activation review --review FILE [--interactive|-i | --json]
  budget activation set --review FILE --decision JSON --expected-review N
  budget activation preview --review FILE
  budget activation commit --review FILE --expected-review N --confirm
  budget opening amend --month YYYY-MM --review NEW_FILE
  budget category add --group NAME --name NAME [--id ID] --expected-version N --confirm
  budget category rename ID --name NAME [--group NAME] --expected-version N --confirm
  budget category archive|unarchive ID --expected-version N --confirm
  budget category reorder ID --position N [--group NAME] --expected-version N --confirm
  budget assign --month YYYY-MM --category ID --amount SIGNED_USD --expected-version N --confirm
  budget move --month YYYY-MM --from CATEGORY --to CATEGORY --amount USD --expected-version N --confirm
  budget allocate TRANSACTION --category ID|--line ID:SIGNED_USD [--line ID:SIGNED_USD]|--income|--unallocated --expected-transaction-version N --expected-version N --confirm
  budget transfer add --from ACCOUNT --to ACCOUNT --date DATE --amount USD [--category ID] --expected-from-version N --expected-to-version N --expected-version N --confirm
  budget transfer link (same flags as add) --from-transaction ID --to-transaction ID
  budget transfer edit ID --date DATE --amount USD [--category ID] --expected-activity-version N --expected-version N --confirm
  budget transfer unlink ID --expected-activity-version N --expected-version N --confirm
  budget activity [--month YYYY-MM] [--unallocated]
  budget activity correct ID --decision JSON --expected-activity-version N --expected-version N --confirm
  budget show [--month YYYY-MM]
All budget commands require --db PATH. JSON never prompts. Activity version equals budget revision.
Activation decision: {"kind":"facts","facts":BudgetFacts,"coverage":{"throughDate":"YYYY-MM-DD","evidence":"reviewed evidence","includedTransactionIds":[],"postedBridgeEventIds":[]}}.
Activity correction decision is one complete BudgetEvent with its original id and sourceId. See docs/slice-3-demo.md for complete JSON shapes.
`;
async function execute(command: BudgetTerminalCommand, prompts: TerminalPrompts) {
  if (command.interactive && !prompts.interactive) throw new Error("interactive-terminal-required");
  const target = lstatSync(command.database);
  if (target.isSymbolicLink() || !target.isFile()) throw new Error("invalid-path");
  if (command.action.startsWith("activation ") || command.action === "opening amend")
    return executeBudgetActivation(command, prompts, localToday());
  const app = budgetApplication(command.database),
    snapshot = app.inspect();
  if (command.action === "status")
    return {
      targetId: snapshot.targetId,
      status: snapshot.state?.status ?? "inactive",
      revision: snapshot.state?.revision ?? 0,
      startMonth: snapshot.state?.facts.startMonth ?? null,
    };
  if (command.action === "show")
    return budgetValue(
      app.report(budgetValue(parseMonth(command.flags.get("--month") ?? localToday().slice(0, 7)))),
    );
  if (command.action === "activity") return activity(command, snapshot);
  return write(command, prompts, app, snapshot);
}
async function write(
  command: BudgetTerminalCommand,
  prompts: TerminalPrompts,
  app: ReturnType<typeof budgetApplication>,
  snapshot: BudgetSnapshot,
) {
  const operation = budgetWriteCommand(command, snapshot, randomUUID()),
    expected = budgetInteger(budgetFlag(command, "--expected-version"), 1),
    preview = budgetValue(app.preview(operation, expected));
  if (!command.json)
    process.stderr.write(
      `Target: ${command.database}\nBefore:\n${JSON.stringify(snapshot.state?.facts ?? null, null, 2)}\nPreview:\n${JSON.stringify(preview, null, 2)}\nCalculated before/after, affected months, and warnings:\n${JSON.stringify(budgetPreviewSummary(snapshot.state?.facts ?? null, preview.after, localToday()), null, 2)}\n`,
    );
  if (!command.confirm) {
    if (command.json || !prompts.interactive) throw new Error("confirm-required");
    if (!(await confirm(prompts, "Apply this budget change?"))) throw new PromptCancelled();
  }
  return budgetValue(app.commit(preview));
}
function parseFailure(error: unknown) {
  if (error instanceof SyntaxError)
    return { reason: "invalid-json", code: 2, message: "Invalid JSON decision" };
  if (error instanceof Error && "code" in error) {
    if (error.code === "ENOENT")
      return { reason: "source-or-target-missing", code: 3, message: error.message };
    if (["EEXIST", "EISDIR", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes(String(error.code)))
      return { reason: "invalid-path", code: 2, message: error.message };
  }
  const message = error instanceof Error ? error.message : "storage-failure",
    reason = /^[a-z][a-z0-9-]*$/.test(message) ? message : "storage-failure";
  const conflict =
    reason.includes("stale") ||
    ["review-locked", "budget-active", "opening-needs-review", "linked-transfer"].includes(reason);
  const missing = reason.endsWith("-unavailable") || reason.endsWith("-not-found");
  let code = 2;
  if (reason === "storage-failure") code = 1;
  if (missing) code = 3;
  if (conflict) code = 4;
  return { reason, code, message };
}
export async function runBudgetArguments(args: string[], prompts: TerminalPrompts) {
  const json = args.includes("--json");
  try {
    const command = parseBudgetArguments(args),
      value = await execute(command, prompts);
    if (!json && command.action === "show" && "month" in value && "categories" in value)
      process.stdout.write(`${renderBudgetReport(value)}\n`);
    else if (json) writeJson({ ok: true, ...value });
    else process.stdout.write(`${JSON.stringify({ ok: true, ...value }, null, 2)}\n`);
  } catch (error) {
    if (error instanceof PromptCancelled) {
      if (json) writeJson({ ok: true, canceled: true });
      else process.stdout.write(`${JSON.stringify({ ok: true, canceled: true })}\n`);
      return;
    }
    const failure = parseFailure(error);
    process.exitCode = failure.code;
    if (json)
      writeJson(
        {
          ok: false,
          reason: failure.reason,
          message: failure.message,
          operationId: /Operation ID: ([^.]+)\./.exec(failure.message)?.[1] ?? null,
        },
        process.stderr,
      );
    else process.stderr.write(`${failure.message}\n`);
  }
}

function activity(command: BudgetTerminalCommand, snapshot: BudgetSnapshot) {
  if (!snapshot.state) throw new Error("budget-inactive");
  const month = command.flags.has("--month")
    ? budgetValue(parseMonth(budgetFlag(command, "--month")))
    : null;
  const events = snapshot.state.facts.events.filter(
    (e) =>
      (month === null || e.date.slice(0, 7) === month) &&
      (!command.flags.has("--unallocated") ||
        (e.kind === "transaction" && e.allocation.kind === "unallocated")),
  );
  return { revision: snapshot.state.revision, activityVersion: snapshot.state.revision, events };
}
