import { executeSnapshot } from "../../src/cli/snapshots.js";
import { parseArguments } from "../../src/cli/parse.js";
import { completeCommand, confirmWrite, PromptCancelled } from "../../src/cli/prompts.js";
import { afterEach, expect, it, vi } from "vitest";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  const run = (...args: string[]) => runCli(["--db", f.path, ...args], f.directory);
  expect(run("init", "--confirm").status).toBe(0);
  const account = run(
    "account",
    "add",
    "--name",
    "Synthetic",
    "--kind",
    "tracking",
    "--confirm",
    "--json",
  );
  return { run, id: String(JSON.parse(account.stdout).account.id) };
}
it("adds dated observations with qualified last known output without summing them", () => {
  const { run, id } = setup();
  expect(run("account", "show", id).stdout).toContain("no balance recorded");
  const first = run(
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "2026-10-15",
    "--balance",
    "5000",
    "--confirm",
    "--json",
  );
  expect(first.status).toBe(0);
  const second = run(
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "2026-10-16",
    "--balance",
    "5200",
    "--confirm",
    "--json",
  );
  expect(second.status).toBe(0);
  const show = run("account", "show", id);
  expect(show.stdout).toContain("last known USD 5200.00 on 2026-10-16 | manual");
  expect(show.stdout).not.toContain("10200");
});
it("guides a same-date conflict to an explicit signed correction", () => {
  const { run, id } = setup();
  const added = run(
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "2026-10-16",
    "--balance",
    "5200",
    "--confirm",
    "--json",
  );
  expect(added.status).toBe(0);
  const snapshot = JSON.parse(added.stdout).snapshot;
  const duplicate = run(
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "2026-10-16",
    "--balance",
    "0",
    "--confirm",
  );
  expect(duplicate.status).toBe(4);
  expect(duplicate.stderr).toContain(snapshot.id);
  expect(duplicate.stderr).toContain("snapshot correct");
  const correction = run(
    "snapshot",
    "correct",
    snapshot.id,
    "--balance",
    "-100",
    "--expected-version",
    "1",
    "--confirm",
    "--json",
  );
  expect(correction.status).toBe(0);
  expect(JSON.parse(correction.stdout).snapshot).toMatchObject({
    id: snapshot.id,
    balanceCents: -10000,
    revision: 2,
  });
  expect(run("snapshot", "list", "--account", id).stdout).toContain("-100.00");
});
it.each([
  ["add", "--account", "synthetic", "--balance", "1"],
  ["add", "--account", "synthetic", "--as-of", "2026-10-16"],
  ["add", "--as-of", "2026-10-16", "--balance", "1"],
  ["correct", "missing", "--balance", "0"],
  ["list", "--account", "synthetic", "--confirm"],
  ["list", "--account", "synthetic", "--account", "synthetic"],
  ["list", "--unknown"],
])("rejects incomplete or invalid script flags: %j", (...args) => {
  const f = temporaryDatabase();
  fixtures.push(f);
  expect(runCli(["--db", f.path, "snapshot", ...args], f.directory).status).toBe(2);
});
it("requires script confirmation and keeps observations out of register and reconciliation", () => {
  const { run, id } = setup();
  expect(
    run("snapshot", "add", "--account", id, "--as-of", "2026-10-16", "--balance", "0").status,
  ).toBe(2);
  expect(run("snapshot", "list", "--account", id, "--json").stdout).toContain('"snapshots":[]');
  expect(run("register", id).status).toBe(2);
  expect(
    run("reconcile", id, "--as-of", "2026-10-16", "--bank-balance", "0", "--confirm").status,
  ).toBe(2);
});
it("does not claim an empty Tracking history during rename previews or saved results", () => {
  const { run, id } = setup();
  expect(
    run("snapshot", "add", "--account", id, "--as-of", "2026-10-16", "--balance", "0", "--confirm")
      .status,
  ).toBe(0);
  const result = run(
    "account",
    "rename",
    id,
    "--name",
    "Synthetic renamed",
    "--expected-version",
    "2",
    "--confirm",
  );
  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).not.toContain("no balance recorded");
});
it("refuses future observations with a scheduling explanation", () => {
  const { run, id } = setup();
  const result = run(
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "9999-12-31",
    "--balance",
    "0",
    "--confirm",
  );
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Scheduled observations are not supported");
});

it("prompts for signed balance and local date, preserves an explicit date, and allows cancellation", async () => {
  const questions: string[] = [];
  const answers = ["synthetic", "-10", ""];
  const completed = await completeCommand(
    parseArguments(["--db", "/synthetic/plan.sqlite", "snapshot", "add"]),
    {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return answers.shift() ?? "";
      },
    },
    "2026-10-17",
  );
  expect(completed).toMatchObject({ accountId: "synthetic", opening: "-10", date: "2026-10-17" });
  expect(questions.join("\n")).toContain("assets positive, liabilities negative");
  expect(questions.join("\n")).toContain("[2026-10-17]");
  const explicit = parseArguments([
    "--db",
    "/synthetic/plan.sqlite",
    "snapshot",
    "add",
    "--account",
    "synthetic",
    "--as-of",
    "2026-10-15",
    "--balance",
    "0",
  ]);
  expect(
    (
      await completeCommand(
        explicit,
        {
          interactive: true,
          ask: async () => {
            throw new Error("Unexpected prompt");
          },
        },
        "2026-10-17",
      )
    ).date,
  ).toBe("2026-10-15");
  expect(await confirmWrite(completed, { interactive: true, ask: async () => "no" })).toBe(false);
  await expect(
    completeCommand(
      parseArguments(["--db", "/synthetic/plan.sqlite", "snapshot", "correct"]),
      {
        interactive: true,
        ask: async () => {
          throw new PromptCancelled();
        },
      },
      "2026-10-17",
    ),
  ).rejects.toBeInstanceOf(PromptCancelled);
});

it("cancels snapshot confirmation without writing", async () => {
  const { run, id } = setup();
  const command = parseArguments([
    "--db",
    fixtures.at(-1)?.path ?? "",
    "snapshot",
    "add",
    "--account",
    id,
    "--as-of",
    "2026-10-16",
    "--balance",
    "0",
    "--json",
  ]);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await executeSnapshot(command, { interactive: true, ask: async () => "no" });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"canceled":true'));
    await expect(
      executeSnapshot(command, {
        interactive: true,
        ask: async () => {
          throw new PromptCancelled();
        },
      }),
    ).rejects.toBeInstanceOf(PromptCancelled);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  expect(run("snapshot", "list", "--account", id, "--json").stdout).toContain('"snapshots":[]');
});
