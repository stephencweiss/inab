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

it("passes abandon to the review flow so it can clear saved answers", async () => {
  const { askReviewQuestion } = await import("../../src/cli/prompts.js");
  const input = new PassThrough();
  const output = new PassThrough();
  const terminal = createInterface({ input, output, terminal: true });
  try {
    const pending = askReviewQuestion(terminal, "Saved review (quit, abandon): ");
    input.write("abandon\n");
    await expect(pending).resolves.toBe("abandon");
  } finally {
    terminal.close();
    input.destroy();
    output.destroy();
  }
});

it("uses the review reader without losing terminal release support", async () => {
  const { reviewTerminalPrompts, releaseTerminal } = await import("../../src/cli/prompts.js");
  let closed = false;
  const factory = {
    interactive: true,
    ask: async () => {
      throw new Error("generic cancellation reader used");
    },
    askReview: async () => "abandon",
    close: () => {
      closed = true;
    },
  };
  const review = reviewTerminalPrompts(factory);
  await expect(review.ask("Saved review:")).resolves.toBe("abandon");
  releaseTerminal(review);
  expect(closed).toBe(true);
});
