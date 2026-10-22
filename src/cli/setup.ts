import { lstatSync } from "node:fs";
import { setupApplication } from "../bootstrap.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
import { executeMigration } from "./imports.js";
import { executeImportHistory } from "./import-history.js";
import { parseSetupArguments } from "./setup-parse.js";
import type { SetupCommand } from "./setup-parse.js";
function output(json: boolean, value: object) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value }, null, json ? 0 : 2)}\n`);
}
async function fresh(command: SetupCommand, prompts: TerminalPrompts) {
  const app = setupApplication(command.database);
  const before = app.status();
  if (!command.confirm) {
    if (command.json || !prompts.interactive) throw new Error("fresh-confirm-required");
    process.stderr.write(
      `Target: ${command.database}\nStart fresh closes YNAB migration for this database.\n`,
    );
    if ((await prompts.ask("Start fresh? Enter yes (or cancel): ")).toLowerCase() !== "yes")
      throw new PromptCancelled();
  }
  const result = app.chooseFresh(before.revision);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
async function execute(command: SetupCommand, prompts: TerminalPrompts): Promise<object> {
  const target = lstatSync(command.database);
  if (target.isSymbolicLink() || !target.isFile()) throw new Error("invalid-path");
  if (command.action.startsWith("history-")) return executeImportHistory(command);
  if (command.action === "status") return setupApplication(command.database).status();
  if (command.action === "fresh") return fresh(command, prompts);
  if (command.action !== "menu") return executeMigration(command, prompts);
  const status = setupApplication(command.database).status();
  if (status.state !== "open") return status;
  if (command.json || !prompts.interactive) throw new Error("explicit-setup-command-required");
  const choice = (await prompts.ask("Initial setup: fresh or migrate (or cancel): ")).toLowerCase();
  if (choice === "fresh") return fresh({ ...command, action: "fresh" }, prompts);
  if (choice === "migrate") return executeMigration({ ...command, action: "preview" }, prompts);
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
export async function runSetupArguments(args: string[], prompts: TerminalPrompts) {
  const json = args.includes("--json");
  try {
    output(json, await execute(parseSetupArguments(args), prompts));
  } catch (error) {
    if (error instanceof PromptCancelled) {
      output(json, { canceled: true });
      return;
    }
    const failed = parseFailure(error);
    process.exitCode = failed.code;
    const operation = failed.operationId === null ? "" : `; operation ${failed.operationId}`;
    process.stderr.write(
      json
        ? `${JSON.stringify({ ok: false, reason: failed.reason, operationId: failed.operationId })}\n`
        : `${failed.reason}${operation}\n`,
    );
  }
}
