import { parseArguments } from "../../src/cli/parse.js";
import { completeCommand, PromptCancelled } from "../../src/cli/prompts.js";
import { executeReconciliation } from "../../src/cli/reconciliation.js";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("reports mismatch with exit 4, confirms a match, lists evidence and shows register coverage", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) => runCli(["--db", f.path, ...args], f.directory);
  const a = run([
    "account",
    "add",
    "--name",
    "Synthetic",
    "--kind",
    "cash",
    "--opening",
    "1000",
    "--as-of",
    "2026-10-16",
    "--confirm",
    "--json",
  ]);
  const id = JSON.parse(a.stdout).account.id;
  for (const [amount, posted] of [
    ["-60", false],
    ["-25", true],
  ] as const) {
    const r = run([
      "transaction",
      "add",
      "--account",
      id,
      "--date",
      "2026-10-17",
      "--amount",
      amount,
      "--payee",
      "Synthetic",
      "--confirm",
      "--json",
      ...(posted ? ["--posted-on", "2026-10-17"] : []),
    ]);
    expect(r.status, r.stderr).toBe(0);
  }
  const base = ["reconcile", id, "--as-of", "2026-10-17", "--bank-balance"];
  const mismatch = run([...base, "970", "--confirm", "--json"]);
  expect(mismatch.status, mismatch.stderr).toBe(4);
  expect(JSON.parse(mismatch.stdout)).toMatchObject({
    differenceCents: -500,
    computedCents: 97500,
  });
  expect(
    JSON.parse(run(["reconciliation", "list", "--account", id, "--json"]).stdout).reconciliations,
  ).toEqual([]);
  expect(run([...base, "975", "--json"]).status).toBe(2);
  const saved = run([...base, "975", "--confirm", "--json"]);
  expect(saved.status, saved.stderr).toBe(0);
  expect(JSON.parse(saved.stdout).reconciliation.entries).toHaveLength(1);
  expect(run(["register", id]).stdout).toContain("reconciled");
  expect(
    JSON.parse(run(["register", id, "--json"]).stdout).entries.map(
      (e: { clearance: string }) => e.clearance,
    ),
  ).toContain("reconciled");
  for (const args of [
    ["reconcile", id, "--confirm"],
    [...base, "975", "--amount", "975"],
    ["reconciliation", "list", "--account", id, "--confirm"],
  ])
    expect(run(args).status).toBe(2);
  expect(
    run(["reconcile", "missing", "--as-of", "2026-10-17", "--bank-balance", "0", "--confirm"])
      .status,
  ).toBe(3);
}, 30000);
it("prompts with local cutoff defaults, keeps explicit dates, and cancels without evidence", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) => runCli(["--db", f.path, ...args], f.directory);
  const added = run([
    "account",
    "add",
    "--name",
    "Synthetic credit",
    "--kind",
    "credit",
    "--opening",
    "-100",
    "--as-of",
    "2026-10-16",
    "--confirm",
    "--json",
  ]);
  const id = JSON.parse(added.stdout).account.id;
  const answers = [id, "-100", ""];
  const questions: string[] = [];
  const prompts = {
    interactive: true,
    ask: async (question: string) => {
      questions.push(question);
      return answers.shift() ?? "no";
    },
  };
  const command = await completeCommand(
    parseArguments(["--db", f.path, "reconcile", "--json"]),
    prompts,
    "2026-10-17",
  );
  expect(command.date).toBe("2026-10-17");
  expect(questions.join("\n")).toContain("[2026-10-17]");
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await executeReconciliation(command, prompts);
    expect(stdout.mock.calls.map((c) => c[0]).join("")).toContain('"canceled":true');
    expect(stderr.mock.calls.map((c) => c[0]).join("")).toContain("Computed USD -100.00");
    await expect(
      executeReconciliation(command, {
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
  expect(
    JSON.parse(run(["reconciliation", "list", "--account", id, "--json"]).stdout).reconciliations,
  ).toEqual([]);
  const explicit = await completeCommand(
    parseArguments([
      "--db",
      f.path,
      "reconcile",
      id,
      "--as-of",
      "2026-10-16",
      "--bank-balance",
      "-100",
    ]),
    {
      interactive: true,
      ask: async () => {
        throw new Error("Unexpected prompt");
      },
    },
    "2026-10-17",
  );
  expect(explicit.date).toBe("2026-10-16");
  const saved = run([
    "reconcile",
    id,
    "--as-of",
    "2026-10-16",
    "--bank-balance",
    "-100",
    "--confirm",
    "--json",
  ]);
  expect(saved.status, saved.stderr).toBe(0);
  expect(JSON.parse(saved.stdout).reconciliation).toMatchObject({ bankCents: -10000, entries: [] });
});
