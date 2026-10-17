import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import type { TerminalCommand } from "./parse.js";

export class PromptCancelled extends Error {}
export class InvalidInput extends Error {}
export type TerminalPrompts = {
  ask: (question: string) => Promise<string>;
  interactive: boolean;
};
export function terminalPrompts() {
  const interactive = Boolean(stdin.isTTY && stderr.isTTY);
  let readline: ReturnType<typeof createInterface> | null = null;
  return {
    interactive,
    ask: async (question: string) => {
      if (!interactive)
        throw new InvalidInput("Missing input; supply command flags in noninteractive mode");
      readline ??= createInterface({ input: stdin, output: stderr });
      try {
        const answer = await readline.question(question);
        if (answer.toLowerCase() === "cancel") throw new PromptCancelled();
        return answer;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new PromptCancelled();
        if (error instanceof Error && "code" in error && error.code === "ERR_USE_AFTER_CLOSE")
          throw new PromptCancelled();
        throw error;
      }
    },
    close: () => readline?.close(),
  };
}
async function required(value: string | null, question: string, prompts: TerminalPrompts) {
  return value === null ? prompts.ask(question) : value;
}
async function completeVersion(value: TerminalCommand, prompts: TerminalPrompts) {
  if (value.expectedVersion === null) {
    const version = await prompts.ask("Expected revision (or cancel): ");
    if (!/^\d+$/.test(version)) throw new InvalidInput("Invalid expected version");
    value.expectedVersion = Number(version);
  }
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1)
    throw new InvalidInput("Invalid expected version");
}
async function completeOpening(value: TerminalCommand, prompts: TerminalPrompts, today: string) {
  value.opening = await required(
    value.opening,
    "Signed USD opening balance; cash inflow positive, outflow negative; credit debt negative (or cancel): ",
    prompts,
  );
  if (value.date !== null) return;
  if (!prompts.interactive) throw new InvalidInput("Scripts require --as-of YYYY-MM-DD");
  value.date = (await prompts.ask(`Posted closing balance date [${today}] (or cancel): `)) || today;
}
export async function completeCommand(
  command: TerminalCommand,
  prompts: TerminalPrompts,
  today: string,
): Promise<TerminalCommand> {
  const value = { ...command };
  if (value.action.startsWith("transaction-") || value.action === "register")
    return completeTransaction(value, prompts, today);
  if (["show", "rename", "opening"].includes(value.action))
    value.id = await required(value.id, "Account ID (or cancel): ", prompts);
  if (value.action === "rename" || value.action === "opening")
    await completeVersion(value, prompts);
  if (value.action === "add" || value.action === "rename")
    value.name = await required(value.name, "Account name (or cancel): ", prompts);
  if (value.action === "add")
    value.kind = await required(
      value.kind,
      "Account kind: cash, credit, tracking (or cancel): ",
      prompts,
    );
  if (value.kind === "tracking") {
    if (value.opening !== null || value.date !== null)
      throw new InvalidInput("Tracking accounts have no opening pair");
  } else if (value.action === "add" || value.action === "opening") {
    await completeOpening(value, prompts, today);
  }
  return value;
}
export async function confirmWrite(command: TerminalCommand, prompts: TerminalPrompts) {
  if (command.confirm) return true;
  if (!prompts.interactive)
    throw new InvalidInput("Write requires --confirm in noninteractive mode");
  return (await prompts.ask("Apply this change? [yes/no] (or cancel): ")).toLowerCase() === "yes";
}

async function completeTransaction(
  value: TerminalCommand,
  prompts: TerminalPrompts,
  today: string,
) {
  if (value.action === "transaction-add")
    value.accountId = await required(value.accountId, "Account ID (or cancel): ", prompts);
  else
    value.id = await required(
      value.id,
      value.action === "register" ? "Account ID (or cancel): " : "Transaction ID (or cancel): ",
      prompts,
    );
  if (value.action === "register") return value;
  if (value.action !== "transaction-add") await completeVersion(value, prompts);
  if (value.action === "transaction-add" || value.action === "transaction-edit")
    await completeTransactionFields(value, prompts, today);
  if (value.action === "transaction-clear" && value.postedOn === null) {
    if (!prompts.interactive) throw new InvalidInput("Scripts require --posted-on YYYY-MM-DD");
    value.postedOn = (await prompts.ask(`Posting date [${today}] (or cancel): `)) || today;
  }
  return value;
}

async function completeTransactionFields(
  value: TerminalCommand,
  prompts: TerminalPrompts,
  today: string,
) {
  if (value.date === null) {
    if (!prompts.interactive) throw new InvalidInput("Scripts require --date YYYY-MM-DD");
    value.date = (await prompts.ask(`Occurrence date [${today}] (or cancel): `)) || today;
  }
  value.opening = await required(
    value.opening,
    "Signed USD amount; inflow positive, outflow and credit debt negative (or cancel): ",
    prompts,
  );
  value.payee = await required(value.payee, "Payee (or cancel): ", prompts);
  value.memo =
    value.action === "transaction-add"
      ? (value.memo ?? "")
      : await required(value.memo, "Memo; empty clears it (or cancel): ", prompts);
}
