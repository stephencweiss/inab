import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { setupApplication, migrationApplication } from "../../src/bootstrap.js";
import { executeMigration } from "../../src/cli/imports.js";
import { parseSetupArguments } from "../../src/cli/setup-parse.js";
import { PromptCancelled } from "../../src/cli/prompts.js";
import { runSetupArguments } from "../../src/cli/setup.js";
import { temporaryDatabase } from "../helpers/database.js";

const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  fixtures.splice(0).forEach((fixture) => fixture.cleanup());
});
async function fixture() {
  const value = temporaryDatabase();
  fixtures.push(value);
  await initializeDatabase(value.path);
  return value;
}
it("explains initial setup and fresh confirmation without selecting or writing on help", async () => {
  const value = await fixture();
  const answers = ["H", "f", "HELP", "N"];
  const questions: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runSetupArguments(["--db", value.path, "setup"], {
    interactive: true,
    ask: async (question) => {
      questions.push(question);
      expect(setupApplication(value.path).status().state).toBe("open");
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected prompt");
      return answer;
    },
  });
  expect(questions[0]).toBe(questions[1]);
  expect(questions[2]).toBe(questions[3]);
  expect(questions.every((question) => question.includes("[h]elp"))).toBe(true);
  expect(stderr.mock.calls.map(([value]) => String(value)).join("")).toContain(
    "closes YNAB imports",
  );
  expect(setupApplication(value.path).status().state).toBe("open");
});
it("requires explicit confirmation after help on the scripted migration commit command", async () => {
  const value = await fixture();
  const register = join(value.directory, "register.csv");
  const plan = join(value.directory, "plan.csv");
  const review = join(value.directory, "review.json");
  copyFileSync(new URL("../fixtures/ynab/register.csv", import.meta.url), register);
  copyFileSync(new URL("../fixtures/ynab/plan.csv", import.meta.url), plan);
  const app = migrationApplication(value.path);
  let view = app.preview({ registerPath: register, planPath: plan, reviewPath: review });
  const key = view.sourceAccounts.at(0)?.key;
  if (!key) throw new Error("Missing synthetic account");
  view = await app.change(review, view.revision, {
    tag: "account",
    sourceAccount: key,
    name: "Demo cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(review, view.revision, {
    tag: "opening",
    accountKey: key,
    date: "2026-10-22",
    cents: 10000,
  });
  view = await app.change(review, view.revision, { tag: "ack", key: `history:${key}` });
  const answers = ["h", "", "Y"];
  const questions: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runSetupArguments(
    [
      "--db",
      value.path,
      "setup",
      "migrate",
      "commit",
      "--review",
      review,
      "--expected-review",
      String(view.revision),
    ],
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        expect(setupApplication(value.path).status().state).toBe("open");
        const answer = answers.shift();
        if (answer === undefined) throw new Error("Unexpected prompt");
        return answer;
      },
    },
  );
  expect(questions).toHaveLength(3);
  expect(questions[0]).toBe(questions[1]);
  expect(questions.every((question) => !question.includes("default"))).toBe(true);
  expect(stderr.mock.calls.map(([value]) => String(value)).join("")).toContain(
    "closes further YNAB imports",
  );
  expect(setupApplication(value.path).status().state).toBe("ynab");
});

it.each([
  { field: "date", flags: ["--review", "review.json"], expected: "Observation date" },
  {
    field: "balance",
    flags: ["--review", "review.json", "--as-of", "2026-10-22"],
    expected: "Observed balance",
  },
  { field: "review", flags: [], expected: "Migration review" },
])(
  "uses the relevant dictionary topic for an explicit observation $field prompt",
  async ({ flags, expected }) => {
    const value = await fixture();
    const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const answers = ["h", "a"];
    const questions: string[] = [];
    const command = parseSetupArguments([
      "--db",
      value.path,
      "setup",
      "migrate",
      "observation",
      "account:1",
      "--expected-review",
      "1",
      "--row",
      "synthetic-row",
      ...flags,
    ]);
    await expect(
      executeMigration(command, {
        interactive: true,
        ask: async (question) => {
          questions.push(question);
          const answer = answers.shift();
          if (answer === undefined) throw new Error("Unexpected prompt");
          return answer;
        },
      }),
    ).rejects.toBeInstanceOf(PromptCancelled);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toBe(questions[1]);
    expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(expected);
  },
);
