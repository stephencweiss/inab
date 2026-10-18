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
