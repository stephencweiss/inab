import { requireDatabase } from "./parse.js";
import { resolve } from "node:path";
import { reconciliationApplication } from "../bootstrap.js";
import type { Reconciliation, ReconciliationResult } from "../application/ports.js";
import type { ReconciliationSnapshot } from "../accounts/reconciliation.js";
import { parseMoney } from "../lib/money.js";
import type { TerminalCommand } from "./parse.js";
import { confirmWrite, InvalidInput } from "./prompts.js";
import type { TerminalPrompts } from "./prompts.js";
import { formatCents } from "./render.js";
function unwrap<T>(result: ReconciliationResult<T>) {
  if (result.ok) return result.value;
  process.exitCode = 2;
  if (result.reason === "account-unavailable") process.exitCode = 3;
  if (result.reason === "stale-version" || result.reason === "balance-mismatch")
    process.exitCode = 4;
  throw new InvalidInput(
    result.reason === "tracking-register"
      ? "tracking-register: Tracking accounts use snapshots; reconciliation is not supported in Slice 1."
      : result.reason,
  );
}
function render(snapshot: ReconciliationSnapshot) {
  return `Account ID: ${snapshot.accountId} | revision ${snapshot.accountRevision}\nCutoff: ${snapshot.cutoffDate}\nComputed USD ${formatCents(snapshot.computedCents)}\nBank USD ${formatCents(snapshot.bankCents)}\nDifference USD ${formatCents(snapshot.differenceCents)}\nCredit debt: negative.`;
}
function renderRecord(record: Reconciliation) {
  const evidence = record.entries
    .map(
      (entry) =>
        `${entry.transactionId} | revision ${entry.transactionRevision} | USD ${formatCents(entry.cents)} | posted ${entry.postedOn}`,
    )
    .join("\n");
  return `${record.id} | ${record.status}\n${render(record)}\nOpening USD ${formatCents(record.openingCents)} on ${record.openingDate}\nRecorded: ${record.recordedAt}\n${evidence}`;
}
function output(json: boolean, result: object, text: string) {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${text}\n`);
}
export async function executeReconciliation(command: TerminalCommand, prompts: TerminalPrompts) {
  const app = reconciliationApplication(requireDatabase(command));
  if (command.action === "reconciliation-list") {
    const records = unwrap(app.list(command.accountId ?? ""));
    output(
      command.json,
      { ok: true, reconciliations: records },
      records.map(renderRecord).join("\n") || "No reconciliations",
    );
    return;
  }
  const bank = parseMoney(command.opening);
  if (!bank.ok) throw new InvalidInput(bank.reason);
  const preview = unwrap(app.preview(command.id ?? "", command.date ?? "", bank.value));
  if (preview.differenceCents !== 0) {
    output(command.json, { ok: false, reason: "balance-mismatch", ...preview }, render(preview));
    process.exitCode = 4;
    process.stderr.write(
      "balance-mismatch: Review the register and bank records. No change saved.\n",
    );
    return;
  }
  if (!command.json || !command.confirm)
    process.stderr.write(
      `Database target: ${resolve(requireDatabase(command))}\n${render(preview)}\nOperation ID: ${preview.operationId}\n`,
    );
  if (!(await confirmWrite(command, prompts))) {
    output(
      command.json,
      { ok: true, canceled: true, operationId: null, reconciliation: null },
      "Canceled",
    );
    return;
  }
  const result = unwrap(app.commit(preview));
  const operation = result.operationId === null ? "" : `\nOperation ID: ${result.operationId}`;
  output(
    command.json,
    { ok: true, ...result },
    `${result.reused ? "Existing" : "Saved"} ${renderRecord(result.reconciliation)}${operation}`,
  );
}
