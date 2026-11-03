import { importHistoryApplication } from "../bootstrap.js";
import type { SetupCommand } from "./setup-parse.js";
import { parseSetupInteger, requireSetupFlag } from "./setup-parse.js";
export function executeImportHistory(command: SetupCommand): object {
  const app = importHistoryApplication(command.database);
  if (command.action === "history-accounts") return { accounts: app.accounts() };
  if (command.action === "history-report") {
    const report = app.report(command.selector ?? "");
    if (report === null) throw new Error("import-unavailable");
    return { report };
  }
  const limit = parseSetupInteger(command.flags.get("--limit") ?? "100", 1);
  if (limit > 1000) throw new Error("invalid-page-limit");
  const offset = parseSetupInteger(command.flags.get("--offset") ?? "0", 0);
  if (command.action === "history-register")
    return { history: app.register(command.selector ?? "", limit, offset) };
  const month = requireSetupFlag(command, "--month");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000"))
    throw new Error("invalid-month");
  return { history: app.plan(month, limit, offset) };
}
