import type { ReviewChange } from "../application/import-ports.js";
import { migrationApplication } from "../bootstrap.js";
import { parseDate } from "../lib/date.js";
import { parseMoney } from "../lib/money.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
import type { SetupCommand } from "./setup-parse.js";
import { parseSetupInteger, requireSetupFlag } from "./setup-parse.js";

function date(command: SetupCommand) {
  const result = parseDate(requireSetupFlag(command, "--as-of"));
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function amount(command: SetupCommand) {
  const result = parseMoney(requireSetupFlag(command, "--balance"));
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
export function parseReviewChange(command: SetupCommand): ReviewChange {
  const key = command.selector ?? "";
  if (command.action === "opening")
    return { tag: "opening", accountKey: key, date: date(command), cents: amount(command) };
  if (command.action === "observation")
    return {
      tag: "observation",
      accountKey: key,
      rowKey: requireSetupFlag(command, "--row"),
      date: date(command),
      cents: amount(command),
    };
  if (command.action === "acknowledge") return { tag: "ack", key };
  if (command.action === "account") {
    const kind = requireSetupFlag(command, "--kind");
    if (kind !== "cash" && kind !== "credit" && kind !== "tracking")
      throw new Error("invalid-account-kind");
    const closed = requireSetupFlag(command, "--closed");
    if (closed !== "yes" && closed !== "no") throw new Error("invalid-closed-state");
    return {
      tag: "account",
      sourceAccount: key,
      name: requireSetupFlag(command, "--name"),
      kind,
      closed: closed === "yes",
      newGroup: command.flags.has("--new-group"),
    };
  }
  if (command.action === "resolve") {
    const choice = requireSetupFlag(command, "--choice");
    if (choice !== "correct-data" && choice !== "revise-adjustment" && choice !== "defer")
      throw new Error("invalid-resolution");
    return { tag: "resolve", key, choice };
  }
  if (command.action === "row") return parseRowChange(command, key);
  throw new Error("invalid-review-change");
}
function parseRowChange(command: SetupCommand, key: string): ReviewChange {
  const treatment = requireSetupFlag(command, "--treatment");
  if (treatment !== "history" && treatment !== "pending" && treatment !== "posted")
    throw new Error("invalid-treatment");
  const role = command.flags.get("--role") ?? "transaction";
  if (role !== "transaction" && role !== "adjustment" && role !== "opening")
    throw new Error("invalid-row-role");
  const postedOn = command.flags.get("--posted-on") ?? null;
  if (treatment === "posted") {
    if (postedOn === null || !parseDate(postedOn).ok) throw new Error("posted-date-required");
  } else if (postedOn !== null) throw new Error("unexpected-posted-date");
  return {
    tag: "row",
    key,
    accountKey: command.flags.get("--account") ?? null,
    treatment,
    postedOn,
    payee: command.flags.get("--payee") ?? null,
    role,
  };
}
const inputFlags: Record<string, string[]> = {
  preview: ["--register", "--plan", "--review"],
  review: ["--review"],
  commit: ["--review", "--expected-review"],
  account: ["--review", "--expected-review", "--name", "--kind", "--closed"],
  opening: ["--review", "--expected-review", "--as-of", "--balance"],
  row: ["--review", "--expected-review", "--treatment"],
  observation: ["--review", "--expected-review", "--row", "--as-of", "--balance"],
  resolve: ["--review", "--expected-review", "--choice"],
  acknowledge: ["--review", "--expected-review"],
};
async function completeMigration(command: SetupCommand, prompts: TerminalPrompts) {
  const completed = { ...command, flags: new Map(command.flags) };
  for (const flag of inputFlags[command.action] ?? []) {
    if (!completed.flags.has(flag) && prompts.interactive && !command.json)
      completed.flags.set(flag, await prompts.ask(`${flag.slice(2)} (or cancel): `));
    requireSetupFlag(completed, flag);
  }
  if (
    command.action === "row" &&
    completed.flags.get("--treatment") === "posted" &&
    !completed.flags.has("--posted-on") &&
    prompts.interactive &&
    !command.json
  )
    completed.flags.set(
      "--posted-on",
      await prompts.ask("Bank posting date YYYY-MM-DD (or cancel): "),
    );
  return completed;
}
export async function executeMigration(
  command: SetupCommand,
  prompts: TerminalPrompts,
): Promise<object> {
  const completed = await completeMigration(command, prompts);
  const app = migrationApplication(command.database);
  if (completed.action === "preview")
    return app.preview({
      registerPath: requireSetupFlag(completed, "--register"),
      planPath: requireSetupFlag(completed, "--plan"),
      reviewPath: requireSetupFlag(completed, "--review"),
    });
  const path = requireSetupFlag(completed, "--review");
  if (completed.action === "review") {
    return prompts.interactive && !completed.json
      ? guidedReview(completed, prompts)
      : app.inspect(path);
  }
  if (completed.action === "commit") return commitMigration(completed, prompts);
  const expected = parseSetupInteger(requireSetupFlag(completed, "--expected-review"), 1);
  const change = parseReviewChange(completed);
  if (prompts.interactive && !completed.json) {
    process.stderr.write(
      `Review: ${path}\nTarget: ${command.database}\n${JSON.stringify(change)}\n`,
    );
    if (
      (await prompts.ask("Save this review change? Enter yes (or cancel): ")).toLowerCase() !==
      "yes"
    )
      throw new PromptCancelled();
  }
  return app.change(path, expected, change);
}

function parseGuidedAction(action: string) {
  switch (action) {
    case "account":
    case "opening":
    case "row":
    case "observation":
    case "resolve":
    case "acknowledge":
      return action;
    default:
      throw new Error("invalid-review-action");
  }
}
async function guidedReview(command: SetupCommand, prompts: TerminalPrompts): Promise<object> {
  const path = requireSetupFlag(command, "--review");
  const app = migrationApplication(command.database);
  for (;;) {
    const view = app.inspect(path);
    process.stderr.write(`${JSON.stringify(view, null, 2)}\n`);
    const answer = (
      await prompts.ask(
        "Review action: account, opening, row, observation, resolve, acknowledge, or done (or cancel): ",
      )
    ).toLowerCase();
    if (answer === "done") return view;
    const action = parseGuidedAction(answer);
    const selector = await prompts.ask(
      "Source account, group, row, observation, or issue key (or cancel): ",
    );
    const flags = new Map([
      ["--review", path],
      ["--expected-review", String(view.revision)],
    ]);
    await executeMigration({ ...command, action, selector, flags }, prompts);
  }
}

async function commitMigration(command: SetupCommand, prompts: TerminalPrompts) {
  const app = migrationApplication(command.database);
  const path = requireSetupFlag(command, "--review");
  const expected = parseSetupInteger(requireSetupFlag(command, "--expected-review"), 1);
  if (!command.confirm) {
    if (!prompts.interactive || command.json) throw new Error("commit-confirm-required");
    process.stderr.write(
      `${JSON.stringify(app.inspect(path), null, 2)}\nTarget: ${command.database}\nThis completes setup and prevents later imports.\n`,
    );
    if (
      (
        await prompts.ask(`Commit review revision ${expected}? Enter yes (or cancel): `)
      ).toLowerCase() !== "yes"
    )
      throw new PromptCancelled();
  }
  return app.commit(path, expected);
}
