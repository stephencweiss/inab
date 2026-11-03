import { expect, it } from "vitest";
import { parseArguments } from "../../src/cli/parse.js";
import {
  completeCommand,
  confirmWrite,
  InvalidInput,
  PromptCancelled,
} from "../../src/cli/prompts.js";

it("prompts for missing creation values and shows the injected local date default", async () => {
  const questions: string[] = [];
  const answers = ["Synthetic interactive", "credit", "-12.34", ""];
  const prompts = {
    interactive: true,
    ask: async (question: string) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
  };
  const command = await completeCommand(
    parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]),
    prompts,
    "2026-10-17",
  );
  expect(command).toMatchObject({
    name: "Synthetic interactive",
    kind: "credit",
    opening: "-12.34",
    date: "2026-10-17",
  });
  expect(questions.join("\n")).toContain("[2026-10-17]");
  expect(questions.join("\n")).toContain("credit debt negative");
});
it("requires expected revision for prompted edits and preserves explicit dates", async () => {
  const answers = ["synthetic-id", "3", "Synthetic renamed"];
  const prompts = { interactive: true, ask: async () => answers.shift() ?? "" };
  const rename = await completeCommand(
    parseArguments(["--db", "/synthetic/plan.sqlite", "account", "rename"]),
    prompts,
    "2026-10-17",
  );
  expect(rename).toMatchObject({
    id: "synthetic-id",
    expectedVersion: 3,
    name: "Synthetic renamed",
  });
  const opening = await completeCommand(
    parseArguments([
      "--db",
      "/synthetic/plan.sqlite",
      "account",
      "opening",
      "synthetic-id",
      "--expected-version",
      "3",
      "--amount",
      "0",
      "--as-of",
      "2026-10-15",
    ]),
    {
      interactive: true,
      ask: async () => {
        throw new Error("Unexpected prompt");
      },
    },
    "2026-10-17",
  );
  expect(opening.date).toBe("2026-10-15");
});
it("accepts explicit confirmation and allows cancellation at confirmation", async () => {
  const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
  expect(await confirmWrite(command, { interactive: true, ask: async () => "no" })).toBe(false);
  expect(await confirmWrite(command, { interactive: true, ask: async () => "yes" })).toBe(true);
  await expect(
    confirmWrite(command, {
      interactive: true,
      ask: async () => {
        throw new PromptCancelled();
      },
    }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  await expect(
    confirmWrite(command, { interactive: false, ask: async () => "yes" }),
  ).rejects.toBeInstanceOf(InvalidInput);
  expect(
    await confirmWrite(
      { ...command, confirm: true },
      {
        interactive: false,
        ask: async () => {
          throw new Error("Unexpected prompt");
        },
      },
    ),
  ).toBe(true);
});

it.each(["y", "Y", "yes", " YES "])("accepts manual write confirmation %s", async (answer) => {
  const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
  expect(await confirmWrite(command, { interactive: true, ask: async () => answer })).toBe(true);
});

it.each(["n", "N", "no", " NO "])("rejects manual write confirmation %s", async (answer) => {
  const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
  expect(await confirmWrite(command, { interactive: true, ask: async () => answer })).toBe(false);
});

it.each(["a", "A", "abandon", " AbAnDoN ", "cancel"])(
  "abandons manual confirmation for %s",
  async (answer) => {
    const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
    await expect(
      confirmWrite(command, { interactive: true, ask: async () => answer }),
    ).rejects.toBeInstanceOf(PromptCancelled);
  },
);

it("requires explicit yes or no after blank or invalid write confirmation", async () => {
  const command = parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]);
  const questions: string[] = [];
  const answers = ["", "maybe", "Y"];
  const confirmed = await confirmWrite(command, {
    interactive: true,
    ask: async (question) => {
      questions.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected prompt");
      return answer;
    },
  });
  expect(confirmed).toBe(true);
  expect(questions).toHaveLength(3);
  expect(questions[0]).toContain("[y]es, [n]o, [h]elp, [a]bandon");
  expect(questions[0]).not.toContain("default");
  expect(questions.join(" ")).not.toContain("cancel");
});

it.each([
  { args: ["account", "add"], answers: ["Demo", "cash", "100.00", ""] },
  { args: ["account", "show"], answers: ["account-id"] },
  { args: ["account", "rename"], answers: ["account-id", "1", "Renamed"] },
  { args: ["account", "opening"], answers: ["account-id", "1", "100.00", ""] },
  { args: ["transaction", "add"], answers: ["account-id", "", "-1.00", "Demo shop"] },
  { args: ["transaction", "edit"], answers: ["entry-id", "1", "", "-1.00", "Demo shop", ""] },
  { args: ["transaction", "clear"], answers: ["entry-id", "1", ""] },
  { args: ["transaction", "unclear"], answers: ["entry-id", "1"] },
  { args: ["register"], answers: ["account-id"] },
  { args: ["reconcile"], answers: ["account-id", "100.00", ""] },
  { args: ["reconciliation", "list"], answers: ["account-id"] },
  { args: ["snapshot", "add"], answers: ["account-id", "100.00", ""] },
  { args: ["snapshot", "correct"], answers: ["snapshot-id", "1", "100.00"] },
  { args: ["snapshot", "list"], answers: ["account-id"] },
  { args: ["backup"], answers: ["/synthetic/backup.sqlite"] },
  { args: ["restore"], answers: ["/synthetic/backup.sqlite", "/synthetic/restored.sqlite"] },
])("manual prompts show abandon for $args", async ({ args, answers }) => {
  const questions: string[] = [];
  const pending = [...answers];
  const command = parseArguments(
    args[0] === "restore" ? args : ["--db", "/synthetic/plan.sqlite", ...args],
  );
  const completed = await completeCommand(
    command,
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        const answer = pending.shift();
        if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
        return answer;
      },
    },
    "2026-10-30",
  );
  expect(questions.length).toBeGreaterThan(0);
  for (const question of questions) {
    expect(question).toContain("[a]bandon");
    expect(question.toLowerCase()).not.toContain("cancel");
  }
  if (args.join(" ") === "transaction edit") expect(completed.memo).toBe("");
});

it("keeps the same error identity when exported through the prompts module", async () => {
  const errors = await import("../../src/cli/prompt-errors.js");
  expect(errors.PromptCancelled).toBe(PromptCancelled);
});

it("offers the available Tracking shortcut in manual account creation", async () => {
  const questions: string[] = [];
  const answers = ["Demo investment", "c", "T"];
  const value = await completeCommand(
    parseArguments(["--db", "/synthetic/plan.sqlite", "account", "add"]),
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
        return answer;
      },
    },
    "2026-10-30",
  );
  expect(value.kind).toBe("tracking");
  expect(questions[1]).toContain("cash, credit, [t]racking");
  expect(questions[2]).toContain("Invalid choice");
});
