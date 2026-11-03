import { parseDate } from "../lib/date.js";
import { parseMoney } from "../lib/money.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompt-errors.js";
import { termHelp } from "./migration-terms.js";
import type { MigrationTerm } from "./migration-terms.js";

async function answer(
  prompts: TerminalPrompts,
  question: string,
  topic: MigrationTerm,
  shortHelp = true,
) {
  const actionQuestion = `--> ${question}`;
  for (;;) {
    const value = (await prompts.ask(actionQuestion)).trim();
    const command = value.toLowerCase();
    if (command === "cancel" || command === "abandon" || command === "a")
      throw new PromptCancelled();
    if (command !== "help" && !(shortHelp && command === "h")) return value;
    process.stderr.write(`${termHelp(topic)}\n`);
  }
}

export async function historyAction(
  prompts: TerminalPrompts,
  allowBack = false,
): Promise<"history" | "edit" | "save" | "back"> {
  let retry = "";
  for (;;) {
    const value = (
      await answer(
        prompts,
        `${retry}Action ([h]istory, [e]dit, [s]ave, ${allowBack ? "[b]ack, " : ""}[a]bandon, help): `,
        "history-coverage",
        false,
      )
    ).toLowerCase();
    if (value === "h" || value === "history") return "history";
    if (value === "e" || value === "edit") return "edit";
    if (value === "s" || value === "save") return "save";
    if (allowBack && (value === "b" || value === "back")) return "back";
    retry = "Invalid choice. ";
  }
}

export async function startReview(prompts: TerminalPrompts): Promise<boolean> {
  let retry = "";
  for (;;) {
    const value = (
      await answer(
        prompts,
        `${retry}Start migration review ([c]ontinue (default), [d]one, [h]elp, [a]bandon): `,
        "review",
      )
    ).toLowerCase();
    if (value === "" || value === "c" || value === "continue") return true;
    if (value === "d" || value === "done") return false;
    retry = "Invalid choice. ";
  }
}

export async function accountClosed(prompts: TerminalPrompts): Promise<boolean> {
  let retry = "";
  for (;;) {
    const value = (
      await answer(
        prompts,
        `${retry}Is this account closed? ([n]o (default), [y]es, [h]elp, [a]bandon): `,
        "closed-account",
      )
    ).toLowerCase();
    if (value === "" || value === "n" || value === "no") return false;
    if (value === "y" || value === "yes") return true;
    retry = "Invalid choice. ";
  }
}

export async function saveChoice(prompts: TerminalPrompts): Promise<boolean> {
  let retry = "";
  for (;;) {
    const value = (
      await answer(
        prompts,
        `${retry}Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon): `,
        "review-choice",
      )
    ).toLowerCase();
    if (value === "" || value === "y" || value === "yes") return true;
    if (value === "n" || value === "no") return false;
    retry = "Invalid choice. ";
  }
}

export async function keepSaved(
  prompts: TerminalPrompts,
  label: string,
  topic: MigrationTerm = "review",
): Promise<boolean> {
  let retry = "";
  for (;;) {
    const value = (
      await answer(
        prompts,
        `${retry}${label} ([k]eep (default), [e]dit, [h]elp, [a]bandon): `,
        topic,
      )
    ).toLowerCase();
    if (value === "" || value === "k" || value === "keep") return true;
    if (value === "e" || value === "edit") return false;
    retry = "Invalid choice. ";
  }
}

function choiceHint(value: string, values: readonly string[]) {
  const initial = value.charAt(0);
  if (!/^[a-z]$/.test(initial) || initial === "h" || initial === "a") return value;
  if (values.filter((candidate) => candidate.startsWith(initial)).length !== 1) return value;
  return `[${initial}]${value.slice(1)}`;
}

export async function choice(
  prompts: TerminalPrompts,
  label: string,
  values: readonly string[],
  exit: "cancel" | "abandon" = "abandon",
  topic: MigrationTerm = "review",
  defaultValue: string | null = null,
): Promise<string> {
  if (defaultValue !== null && !values.includes(defaultValue))
    throw new Error("invalid-default-choice");
  const hints = values.map(
    (value) => `${choiceHint(value, values)}${value === defaultValue ? " (default)" : ""}`,
  );
  const accepted = [...hints, "[h]elp", "[a]bandon"].join(", ");
  let retry = "";
  for (;;) {
    const value = (await answer(prompts, `${retry}${label} (${accepted}): `, topic)).toLowerCase();
    if (value === "" && defaultValue !== null) return defaultValue;
    if (value === exit) throw new PromptCancelled();
    if (values.includes(value)) return value;
    const matches = values.filter((candidate) => value.length === 1 && candidate.startsWith(value));
    if (matches.length === 1 && matches[0] !== undefined) return matches[0];
    retry = "Invalid choice. ";
  }
}

export async function text(
  prompts: TerminalPrompts,
  label: string,
  defaultValue: string | null = null,
  topic: MigrationTerm = "account-name",
): Promise<string> {
  const fallback = defaultValue === null ? "" : defaultValue.trim();
  const input = topic === "account-name" ? "name" : "value";
  const question =
    fallback === ""
      ? `${label} (required text; or [h]elp, or [a]bandon): `
      : `${label}: current value is [${fallback}]. [c]onfirm or type new ${input}; or [h]elp, or [a]bandon: `;
  let retry = "";
  for (;;) {
    const value = await answer(prompts, `${retry}${question}`, topic);
    if (fallback !== "" && ["", "c", "confirm"].includes(value.toLowerCase())) return fallback;
    if (value !== "") return value;
    retry = "Enter nonblank text. ";
  }
}

export async function dateAnswer(
  prompts: TerminalPrompts,
  label: string,
  today: string,
  topic: MigrationTerm = "closing-balance-date",
): Promise<string> {
  let retry = "";
  for (;;) {
    const value = await answer(
      prompts,
      `${retry}${label} (YYYY-MM-DD; on or before ${today}; blank keeps [${today}]; or [h]elp, or [a]bandon): `,
      topic,
    );
    const parsed = parseDate(value || today);
    if (parsed.ok && parsed.value <= today) return parsed.value;
    retry = "Invalid date. ";
  }
}

export async function moneyAnswer(
  prompts: TerminalPrompts,
  label: string,
  topic: MigrationTerm = "signed-usd",
): Promise<number> {
  let retry = "";
  for (;;) {
    const value = await answer(
      prompts,
      `${retry}${label} (signed USD, e.g. 12.34, -12.34, or 0; or [h]elp, or [a]bandon): `,
      topic,
    );
    const parsed = parseMoney(value);
    if (parsed.ok) return parsed.value;
    retry = "Invalid USD amount. ";
  }
}

export async function confirm(
  prompts: TerminalPrompts,
  label: string,
  topic: MigrationTerm = "review-choice",
): Promise<boolean> {
  return (await choice(prompts, label, ["yes", "no"], "abandon", topic)) === "yes";
}
