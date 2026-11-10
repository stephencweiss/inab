import { formatJson, writeJson } from "./json.js";
import { recoveryApplication } from "../bootstrap.js";
import type { RecoveryResult } from "../application/ports.js";
import type { TerminalCommand } from "./parse.js";
import { confirmWrite, InvalidInput } from "./prompts.js";
import type { TerminalPrompts } from "./prompts.js";
function unwrap<T>(result: RecoveryResult<T>, json: boolean) {
  if (result.ok) return result.value;
  process.exitCode = result.reason === "missing-source" ? 3 : 2;
  throw new InvalidInput(json ? formatJson(result, process.stderr) : result.message);
}
export async function executeRecovery(command: TerminalCommand, prompts: TerminalPrompts) {
  if (command.action !== "backup" && command.action !== "restore")
    throw new InvalidInput("Invalid recovery operation");
  const source = command.action === "backup" ? command.database : command.source;
  if (source === null || command.destination === null)
    throw new InvalidInput("Explicit source and destination paths are required");
  const app = recoveryApplication();
  const preview = unwrap(app.preview(command.action, source, command.destination), command.json);
  process.stderr.write(
    `${command.action === "backup" ? "Backup" : "Restore"} source: ${preview.source}\nNew destination: ${preview.destination}\nSchema version: ${preview.schemaVersion}; no migration required\nOperation ID: ${preview.operationId}\n`,
  );
  if (!(await confirmWrite(command, prompts))) {
    if (command.json) writeJson({ ok: true, canceled: true, operationId: null, destination: null });
    else process.stdout.write("Abandoned\n");
    return;
  }
  const result = unwrap(await app.commit(preview), command.json);
  if (command.json) writeJson({ ok: true, ...result });
  else
    process.stdout.write(
      `Saved ${command.action}: ${result.destination}\nOperation ID: ${result.operationId}\n`,
    );
}
