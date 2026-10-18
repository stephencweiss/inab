import { requireDatabase } from "./parse.js";
import { resolve } from "node:path";
import { snapshotApplication } from "../bootstrap.js";
import type { Snapshot, SnapshotResult } from "../application/ports.js";
import { parseMoney } from "../lib/money.js";
import type { TerminalCommand } from "./parse.js";
import { confirmWrite, InvalidInput } from "./prompts.js";
import type { TerminalPrompts } from "./prompts.js";
import { formatCents } from "./render.js";
function unwrap<T>(result: SnapshotResult<T>) {
  if (result.ok) return result.value;
  process.exitCode = 2;
  if (result.reason === "account-unavailable" || result.reason === "snapshot-unavailable")
    process.exitCode = 3;
  if (result.reason === "stale-version" || result.reason === "same-date") process.exitCode = 4;
  if (result.reason === "same-date")
    throw new InvalidInput(
      `same-date: Snapshot ${result.existing.id} revision ${result.existing.revision} already records this date. Use snapshot correct ${result.existing.id} --balance AMOUNT --expected-version ${result.existing.revision} with --db PATH and --confirm.`,
    );
  if (result.reason === "future-date")
    throw new InvalidInput("future-date: Scheduled observations are not supported in Slice 1.");
  if (result.reason === "tracking-only")
    throw new InvalidInput(
      "tracking-only: Snapshots require a Tracking account. Cash and Credit use registers and reconciliation.",
    );
  throw new InvalidInput(result.reason);
}
function render(value: Snapshot) {
  return `${value.id} | revision ${value.revision} | ${value.effectiveDate} | USD ${formatCents(value.balanceCents)} | ${value.source} | observed ${value.observedAt}`;
}
function output(json: boolean, value: object, text: string) {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${text}\n`);
}
export async function executeSnapshot(command: TerminalCommand, prompts: TerminalPrompts) {
  const app = snapshotApplication(requireDatabase(command));
  if (command.action === "snapshot-list") {
    const snapshots = unwrap(app.list(command.accountId ?? ""));
    output(
      command.json,
      { ok: true, snapshots },
      snapshots.map(render).join("\n") || "No balance recorded",
    );
    return;
  }
  const amount = parseMoney(command.opening);
  if (!amount.ok) throw new InvalidInput(amount.reason);
  const preview = unwrap(
    command.action === "snapshot-add"
      ? app.previewAdd(command.accountId ?? "", command.date ?? "", amount.value)
      : app.previewCorrect(command.id ?? "", command.expectedVersion ?? 0, amount.value),
  );
  if (!command.json || !command.confirm)
    process.stderr.write(
      `Database target: ${resolve(requireDatabase(command))}\nAccount ID: ${preview.account.id} | revision ${preview.account.revision}\nOperation ID: ${preview.operationId}\nBefore: ${preview.before === null ? "none" : render(preview.before)}\nAfter: ${render(preview.after)}\nAssets: positive; liabilities: negative.\n`,
    );
  if (!(await confirmWrite(command, prompts))) {
    output(
      command.json,
      { ok: true, canceled: true, operationId: null, snapshot: null },
      "Canceled",
    );
    return;
  }
  const result = unwrap(app.commit(preview));
  output(
    command.json,
    { ok: true, ...result },
    `Saved ${render(result.snapshot)}\nOperation ID: ${result.operationId}`,
  );
}
