import { formatJson, writeJson } from "./json.js";
import { choice, confirm } from "./migration-questions.js";
import { lstatSync } from "node:fs";
import { setupApplication } from "../bootstrap.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
import { executeMigration } from "./imports.js";
import { executeImportHistory } from "./import-history.js";
import { parseSetupArguments } from "./setup-parse.js";
import type { SetupCommand } from "./setup-parse.js";
function output(json: boolean, value: object) {
  process.stdout.write(
    `${json ? formatJson({ ok: true, ...value }) : JSON.stringify({ ok: true, ...value }, null, 2)}\n`,
  );
}
async function fresh(command: SetupCommand, prompts: TerminalPrompts) {
  const app = setupApplication(command.database);
  const before = app.status();
  if (!command.confirm) {
    if (command.json || !prompts.interactive) throw new Error("fresh-confirm-required");
    process.stderr.write(
      `Target: ${command.database}\nStart fresh closes YNAB migration for this database.\n`,
    );
    if (!(await confirm(prompts, "Start fresh?", "setup"))) throw new PromptCancelled();
  }
  const result = app.chooseFresh(before.revision);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
async function execute(command: SetupCommand, prompts: TerminalPrompts): Promise<object> {
  if (command.interactive && !prompts.interactive) throw new Error("interactive-terminal-required");
  const target = lstatSync(command.database);
  if (target.isSymbolicLink() || !target.isFile()) throw new Error("invalid-path");
  if (command.action.startsWith("history-")) return executeImportHistory(command);
  if (command.action === "status") return setupApplication(command.database).status();
  if (command.action === "fresh") return fresh(command, prompts);
  if (command.action !== "menu") return executeMigration(command, prompts);
  const status = setupApplication(command.database).status();
  if (status.state !== "open") return status;
  if (command.json || !prompts.interactive) throw new Error("explicit-setup-command-required");
  const selected = await choice(prompts, "Initial setup", ["fresh", "migrate"], "abandon", "setup");
  if (selected === "fresh") return fresh({ ...command, action: "fresh" }, prompts);
  if (selected === "migrate") return executeMigration({ ...command, action: "preview" }, prompts);
  throw new Error("invalid-setup-choice");
}
function parseFailure(error: unknown) {
  const operationId =
    error instanceof Error && "operationId" in error && typeof error.operationId === "string"
      ? error.operationId
      : null;
  if (operationId !== null) return { reason: "storage-failure", code: 1, operationId };
  if (error instanceof Error && "code" in error) {
    if (error.code === "ENOENT")
      return { reason: "source-or-target-missing", code: 3, operationId };
    if (new Set(["EEXIST", "EISDIR", "ENOTDIR", "ELOOP", "ENAMETOOLONG"]).has(String(error.code)))
      return { reason: "invalid-path", code: 2, operationId };
  }
  const reason =
    error instanceof Error && /^[a-z][a-z0-9-]*$/.test(error.message)
      ? error.message
      : "storage-failure";
  const conflicts = new Set([
    "setup-closed",
    "setup-not-empty",
    "review-locked",
    "source-changed",
    "changed-source",
  ]);
  if (reason.includes("stale") || conflicts.has(reason)) return { reason, code: 4, operationId };
  if (reason.includes("missing") || reason.includes("not-found") || reason.includes("unavailable"))
    return { reason, code: 3, operationId };
  return { reason, code: reason === "storage-failure" ? 1 : 2, operationId };
}
function reportAbandoned(json: boolean, reviewing: boolean) {
  if (json) {
    output(json, { canceled: true });
    return;
  }
  process.stdout.write(
    reviewing
      ? "Review abandoned. Saved choices are kept. Run the same review command to resume.\n"
      : "Abandoned\n",
  );
}
function reportResult(command: SetupCommand, result: object, interactive: boolean) {
  if (!command.json && "migrationCompleted" in result && result.migrationCompleted === true)
    process.stdout.write("Migration completed\n");
  else if (command.action === "review" && interactive && !command.json)
    process.stdout.write("Migration review session ended.\n");
  else output(command.json, result);
}
export async function runSetupArguments(args: string[], prompts: TerminalPrompts) {
  let reviewing = false;
  const json = args.includes("--json");
  try {
    const command = parseSetupArguments(args);
    reviewing = command.action === "review";
    const result = await execute(command, prompts);
    reportResult(command, result, prompts.interactive);
  } catch (error) {
    if (error instanceof PromptCancelled) {
      reportAbandoned(json, reviewing);
      return;
    }
    const failed = parseFailure(error);
    process.exitCode = failed.code;
    const operation = failed.operationId === null ? "" : `; operation ${failed.operationId}`;
    if (json)
      writeJson(
        { ok: false, reason: failed.reason, operationId: failed.operationId },
        process.stderr,
      );
    else process.stderr.write(`${failed.reason}${operation}\n`);
  }
}
