import { spawn } from "node:child_process";
import { budgetDraftEditor } from "../bootstrap.js";
import type { BudgetFacts } from "../budget/types.js";
import type { BudgetCoverage } from "../application/budget-ports.js";
import { releaseTerminal } from "./prompts.js";
import type { TerminalPrompts } from "./prompts.js";
type EditableBudgetDraft = { facts: BudgetFacts; coverage: BudgetCoverage };
export function budgetVimArguments(path: string) {
  return [
    "-u",
    "NONE",
    "-U",
    "NONE",
    "-i",
    "NONE",
    "-n",
    "-N",
    "--noplugin",
    "--cmd",
    "set noexrc nomodeline noswapfile nobackup nowritebackup noundofile viminfo=",
    "--",
    path,
  ];
}
export function runBudgetVim(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/vim", budgetVimArguments(path), {
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
/** Returns edited values only. The caller must preview and explicitly save them through the review workflow. */
export async function editBudgetDraft(
  draft: EditableBudgetDraft,
  prompts: TerminalPrompts,
): Promise<EditableBudgetDraft | null> {
  if (!prompts.interactive) throw new Error("interactive-terminal-required");
  releaseTerminal(prompts);
  try {
    return await budgetDraftEditor(draft, runBudgetVim);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "editor-failure";
    throw new Error(
      `Vim edit was not accepted (${reason}). Saved choices are unchanged. Choose Edit to try again.`,
      { cause: error },
    );
  }
}
