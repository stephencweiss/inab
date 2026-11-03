import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { askTerminalQuestion, confirmWrite, PromptCancelled } from "../../src/cli/prompts.js";
import { parseArguments } from "../../src/cli/parse.js";

it.each(["a", "A", "abandon", " ABANDON ", "cancel", " Cancel "])(
  "abandon alias %s stops a real terminal confirmation",
  async (answer) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const terminal = createInterface({ input, output, terminal: true });
    let applied = false;
    try {
      const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
      const pending = confirmWrite(command, {
        interactive: true,
        ask: (question) => askTerminalQuestion(terminal, question),
      }).then((confirmed) => {
        applied = confirmed;
      });
      input.write(`${answer}\n`);
      await expect(pending).rejects.toBeInstanceOf(PromptCancelled);
      expect(applied).toBe(false);
      expect(terminal.listenerCount("SIGINT")).toBe(0);
    } finally {
      terminal.close();
      input.destroy();
      output.destroy();
    }
  },
);

it.each(["SIGINT", "close"])("terminal %s stops a pending question", async (event) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const terminal = createInterface({ input, output, terminal: true });
  try {
    const pending = askTerminalQuestion(terminal, "Name (or [a]bandon): ");
    if (event === "close") terminal.close();
    else terminal.emit(event);
    await expect(pending).rejects.toBeInstanceOf(PromptCancelled);
  } finally {
    terminal.close();
    input.destroy();
    output.destroy();
  }
});

it("keeps raw non-control input unchanged", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const terminal = createInterface({ input, output, terminal: true });
  try {
    const pending = askTerminalQuestion(terminal, "Memo (or [a]bandon): ");
    input.write("  Demo memo  \n");
    await expect(pending).resolves.toBe("  Demo memo  ");
  } finally {
    terminal.close();
    input.destroy();
    output.destroy();
  }
});
