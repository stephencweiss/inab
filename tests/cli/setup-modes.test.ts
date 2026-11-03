import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { parseSetupArguments, isSetupArguments } from "../../src/cli/setup-parse.js";
import { runSetupArguments } from "../../src/cli/setup.js";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";

const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  fixtures.splice(0).forEach((fixture) => fixture.cleanup());
});
const reviewArgs = [
  "--db",
  "/missing/database.sqlite",
  "setup",
  "migrate",
  "review",
  "--review",
  "/missing/review.json",
];

it.each(["--interactive", "-i"])("accepts %s before or after the review command", (flag) => {
  for (const args of [
    [flag, ...reviewArgs],
    [...reviewArgs, flag],
  ]) {
    expect(isSetupArguments(args)).toBe(true);
    expect(parseSetupArguments(args)).toMatchObject({
      action: "review",
      interactive: true,
      json: false,
    });
  }
});
it.each(["--interactive", "-i"])("rejects %s with JSON", (flag) => {
  expect(() => parseSetupArguments([...reviewArgs, flag, "--json"])).toThrow(
    "interactive-json-conflict",
  );
});
it("rejects repeated interactive aliases and interactive on other commands", () => {
  expect(() => parseSetupArguments([...reviewArgs, "-i", "--interactive"])).toThrow(
    "duplicate-flag",
  );
  expect(() => parseSetupArguments(["--db", "/db", "setup", "status", "-i"])).toThrow(
    "invalid-command-flag",
  );
});
it.each(["--interactive", "-i"])(
  "rejects %s without a terminal before reading the missing database",
  async (flag) => {
    const ask = vi.fn(async () => "yes");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSetupArguments([...reviewArgs, flag], { interactive: false, ask });
    expect(process.exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith("interactive-terminal-required\n");
    expect(stdout).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  },
);
async function reviewedFixture() {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const register = join(fixture.directory, "register.csv");
  const plan = join(fixture.directory, "plan.csv");
  const review = join(fixture.directory, "review.json");
  for (const { name, destination } of [
    { name: "register.csv", destination: register },
    { name: "plan.csv", destination: plan },
  ])
    copyFileSync(fileURLToPath(new URL(`../fixtures/ynab/${name}`, import.meta.url)), destination);
  const result = runCli(
    [
      "--db",
      fixture.path,
      "setup",
      "migrate",
      "preview",
      "--register",
      register,
      "--plan",
      plan,
      "--review",
      review,
      "--json",
    ],
    fixture.directory,
  );
  expect(result.status, result.stderr).toBe(0);
  return {
    ...fixture,
    args: ["--db", fixture.path, "setup", "migrate", "review", "--review", review],
  };
}
it("keeps JSON review prompt-free in a terminal", async () => {
  const fixture = await reviewedFixture();
  const ask = vi.fn(async () => {
    throw new Error("unexpected-prompt");
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runSetupArguments([...fixture.args, "--json"], { interactive: true, ask });
  expect(process.exitCode).toBe(0);
  expect(ask).not.toHaveBeenCalled();
  expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({ ok: true, revision: 1 });
});
it("identifies missing script arguments without a prompt", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const ask = vi.fn(async () => {
    throw new Error("unexpected-prompt");
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await runSetupArguments(
    ["--db", fixture.path, "setup", "migrate", "account", "account:1", "--json"],
    { interactive: false, ask },
  );
  expect(process.exitCode).toBe(2);
  expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
    reason: "required-review",
  });
  expect(ask).not.toHaveBeenCalled();
});
it.each([{ mode: [] }, { mode: ["--interactive"] }, { mode: ["-i"] }])(
  "ends guided review with readable output for mode $mode",
  async ({ mode }) => {
    const fixture = await reviewedFixture();
    const ask = vi.fn(async () => "done");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runSetupArguments([...fixture.args, ...mode], { interactive: true, ask });
    expect(process.exitCode).toBe(0);
    expect(ask).toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("Migration review session ended.\n");
  },
);
it("reports guided cancellation with readable output", async () => {
  const fixture = await reviewedFixture();
  const { PromptCancelled } = await import("../../src/cli/prompts.js");
  const ask = vi.fn(async () => {
    throw new PromptCancelled();
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await runSetupArguments(fixture.args, { interactive: true, ask });
  expect(process.exitCode).toBe(0);
  expect(stdout).toHaveBeenCalledWith(
    "Review abandoned. Saved choices are kept. Run the same review command to resume.\n",
  );
});
