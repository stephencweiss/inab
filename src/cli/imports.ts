import { choice, text, dateAnswer, moneyAnswer, confirm } from "./migration-questions.js";
import { formatCents } from "./render.js";
import { guidedMigrationReview } from "./migration-guide.js";
import type { MigrationTerm } from "./migration-terms.js";
import type { ReviewChange } from "../application/import-ports.js";
import { migrationApplication, localToday } from "../bootstrap.js";
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
async function migrationInput(
  flag: string,
  prompts: TerminalPrompts,
  action: SetupCommand["action"],
) {
  const enums: Record<string, string[]> = {
    "--kind": ["cash", "credit", "tracking"],
    "--closed": ["yes", "no"],
    "--treatment": ["history", "pending", "posted"],
    "--choice": ["correct-data", "revise-adjustment", "defer"],
  };
  const values = enums[flag];
  const topics: Record<string, MigrationTerm> = {
    "--kind": "account-kind",
    "--closed": "closed-account",
    "--treatment": "row-treatment",
    "--choice": "resolution",
    "--register": "source-files",
    "--plan": "source-files",
    "--review": "review",
    "--expected-review": "review-revision",
    "--row": "source-row",
  };
  if (values) return choice(prompts, flag.slice(2), values, "abandon", topics[flag] ?? "review");
  if (flag === "--as-of")
    return dateAnswer(
      prompts,
      action === "observation" ? "Observation date" : "Closing balance date",
      localToday(),
      action === "observation" ? "observation-date" : "closing-balance-date",
    );
  if (flag === "--balance")
    return formatCents(
      await moneyAnswer(
        prompts,
        action === "observation" ? "Observed balance" : "Opening balance",
        action === "observation" ? "observed-balance" : "opening-balance",
      ),
    );
  return text(prompts, flag.slice(2), null, topics[flag] ?? "account-name");
}
async function completeMigration(command: SetupCommand, prompts: TerminalPrompts) {
  const completed = { ...command, flags: new Map(command.flags) };
  for (const flag of inputFlags[command.action] ?? []) {
    if (!completed.flags.has(flag) && prompts.interactive && !command.json)
      completed.flags.set(flag, await migrationInput(flag, prompts, command.action));
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
      await dateAnswer(prompts, "Bank posting date", localToday(), "posting-date"),
    );
  return completed;
}
export async function executeMigration(
  command: SetupCommand,
  prompts: TerminalPrompts,
): Promise<object> {
  if (command.interactive && !prompts.interactive) throw new Error("interactive-terminal-required");
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
    if (!completed.json && app.completed(path)) return { migrationCompleted: true };
    return prompts.interactive && !completed.json
      ? guidedMigrationReview(completed, prompts)
      : app.inspect(path);
  }
  if (completed.action === "commit") return commitMigration(completed, prompts);
  const expected = parseSetupInteger(requireSetupFlag(completed, "--expected-review"), 1);
  const change = parseReviewChange(completed);
  if (prompts.interactive && !completed.json) {
    process.stderr.write(
      `Review: ${path}\nTarget: ${command.database}\n${JSON.stringify(change)}\n`,
    );
    if (!(await confirm(prompts, "Save this review change?"))) throw new PromptCancelled();
  }
  return app.change(path, expected, change);
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
    if (!(await confirm(prompts, `Commit review revision ${expected}?`, "import-confirmation")))
      throw new PromptCancelled();
  }
  return app.commit(path, expected);
}
