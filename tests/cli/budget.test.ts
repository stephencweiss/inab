import { readFileSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runBudgetArguments } from "../../src/cli/budget.js";
import { localToday } from "../../src/bootstrap.js";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("labels preview and activation confirmation JSON without saving derived category names", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) =>
    runCli(["--db", f.path, "budget", ...args, "--json"], f.directory);
  const fresh = runCli(["--db", f.path, "setup", "fresh", "--confirm", "--json"], f.directory);
  expect(fresh.status, fresh.stderr).toBe(0);
  const today = localToday();
  const month = today.slice(0, 7);
  const path = join(f.directory, "review.json");
  const started = run(["activation", "start", "--month", month, "--review", path]);
  expect(started.status, started.stderr).toBe(0);
  const facts = {
    startMonth: month,
    currency: "USD",
    opening: {
      accounts: [],
      categories: [{ categoryId: "category-17", availableCents: 0, evidence: "zero" }],
      readyToAssignCents: 0,
      evidence: "checked zero",
      deficitAcknowledged: false,
    },
    categories: [
      { id: "category-17", name: "Food", groupId: "Living", archived: false, cardAccountId: null },
    ],
    assignments: [{ month, categoryId: "category-17", amountCents: 0 }],
    events: [],
  };
  const coverage = {
    throughDate: today,
    evidence: "no activity",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  };
  const set = run([
    "activation",
    "set",
    "--review",
    path,
    "--expected-review",
    "1",
    "--decision",
    JSON.stringify({ kind: "facts", facts, coverage }),
  ]);
  expect(set.status, set.stderr).toBe(0);
  const result = run(["activation", "preview", "--review", path]);
  expect(result.status, result.stderr).toBe(0);
  const printed = JSON.parse(result.stdout);
  const label = { categoryId: "category-17", categoryName: "Food" };
  expect(printed.preview.after.opening.categories[0]).toMatchObject(label);
  expect(printed.review.facts.assignments[0]).toMatchObject(label);
  expect(printed.summary.after.months[0].categories[0]).toMatchObject(label);
  const saved = readFileSync(path, "utf8");
  expect(saved).not.toContain("categoryName");
  const output: string[] = [];
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await runBudgetArguments(
      [
        "--db",
        f.path,
        "budget",
        "activation",
        "commit",
        "--review",
        path,
        "--expected-review",
        String(printed.review.revision),
      ],
      {
        interactive: true,
        ask: async () => {
          expect(output.join("")).toContain('"categoryName": "Food"');
          return "no";
        },
      },
    );
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"canceled":true'));
  } finally {
    stderr.mockRestore();
    stdout.mockRestore();
  }
  expect(readFileSync(path, "utf8")).toBe(saved);
  const committed = run([
    "activation",
    "commit",
    "--review",
    path,
    "--expected-review",
    String(printed.review.revision),
    "--confirm",
  ]);
  expect(committed.status, committed.stderr).toBe(0);
  const plain = runCli(["--db", f.path, "budget", "show", "--month", month], f.directory);
  expect(plain.status, plain.stderr).toBe(0);
  expect(plain.stdout).toMatch(/Category\s+\|\s+ID/);
  expect(plain.stdout).toContain("Food");
  expect(plain.stdout).toContain("category-17");
  const json = run(["show", "--month", month]);
  expect(json.status, json.stderr).toBe(0);
  expect(JSON.parse(json.stdout).month.categories[0].categoryId).toBe("category-17");
}, 30_000);
it("activates explicit facts privately then assigns, shows, and retries without exports", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) =>
    runCli(["--db", f.path, "budget", ...args, "--json"], f.directory);
  expect(run(["status"]).status).toBe(0);
  const fresh = runCli(["--db", f.path, "setup", "fresh", "--confirm", "--json"], f.directory);
  expect(fresh.status, fresh.stderr).toBe(0);
  const review = join(f.directory, "budget-review.json");
  const started = run(["activation", "start", "--month", "2026-11", "--review", review]);
  expect(started.status, started.stderr).toBe(0);
  expect(JSON.parse(started.stdout).review.facts).toBeNull();
  const facts = {
    startMonth: "2026-11",
    currency: "USD",
    opening: {
      accounts: [],
      categories: [],
      readyToAssignCents: 0,
      evidence: "Synthetic reviewed zero",
      deficitAcknowledged: false,
    },
    categories: [],
    assignments: [],
    events: [],
  };
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const coverage = {
    throughDate: today,
    evidence: "Synthetic complete activity",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  };
  const set = run([
    "activation",
    "set",
    "--review",
    review,
    "--expected-review",
    "1",
    "--decision",
    JSON.stringify({ kind: "facts", facts, coverage }),
  ]);
  expect(set.status, set.stderr).toBe(0);
  const preview = run(["activation", "preview", "--review", review]);
  expect(preview.status, preview.stderr).toBe(0);
  const revision = JSON.parse(preview.stdout).review.revision;
  const commitArgs = [
    "activation",
    "commit",
    "--review",
    review,
    "--expected-review",
    String(revision),
    "--confirm",
  ];
  const committed = run(commitArgs);
  expect(committed.status, committed.stderr).toBe(0);
  expect(JSON.parse(committed.stdout)).toMatchObject({ ok: true, revision: 1, reused: false });
  expect(JSON.parse(run(commitArgs).stdout).reused).toBe(true);
  expect(JSON.parse(run(["show", "--month", "2026-11"]).stdout).month.readyToAssignCents).toBe(0);
  const add = run([
    "category",
    "add",
    "--group",
    "Living",
    "--name",
    "Food",
    "--id",
    "food",
    "--expected-version",
    "1",
    "--confirm",
  ]);
  expect(add.status, add.stderr).toBe(0);
  const assign = run([
    "assign",
    "--month",
    "2026-11",
    "--category",
    "food",
    "--amount",
    "0",
    "--expected-version",
    "2",
    "--confirm",
  ]);
  expect(assign.status, assign.stderr).toBe(0);
  expect(JSON.parse(run(commitArgs).stdout).reused).toBe(true);
}, 30_000);
it("rejects a replaced same-ID database and keeps JSON prompt-free", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) =>
    runCli(["--db", f.path, "budget", ...args, "--json"], f.directory);
  const review = join(f.directory, "review.json");
  const started = run(["activation", "start", "--month", "2026-11", "--review", review]);
  expect(started.status, started.stderr).toBe(0);
  const before = readFileSync(review, "utf8");
  const inspected = run(["activation", "review", "--review", review]);
  expect(inspected.status, inspected.stderr).toBe(0);
  expect(readFileSync(review, "utf8")).toBe(before);
  copyFileSync(f.path, join(f.directory, "replacement"));
  renameSync(join(f.directory, "replacement"), f.path);
  const rejected = run(["activation", "review", "--review", review]);
  expect(rejected.status, rejected.stderr).toBe(4);
  expect(JSON.parse(rejected.stderr).reason).toBe("stale-target");
});
it("reports malformed activation JSON as invalid input", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const review = join(f.directory, "review.json");
  const run = (args: string[]) =>
    runCli(["--db", f.path, "budget", ...args, "--json"], f.directory);
  expect(run(["activation", "start", "--month", "2026-11", "--review", review]).status).toBe(0);
  const failed = run([
    "activation",
    "set",
    "--review",
    review,
    "--expected-review",
    "1",
    "--decision",
    "{",
  ]);
  expect(failed.status, failed.stderr).toBe(2);
  expect(JSON.parse(failed.stderr).reason).toBe("invalid-json");
});
it("reports missing activation choices as invalid input", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const review = join(f.directory, "review.json");
  runCli(["--db", f.path, "setup", "fresh", "--confirm", "--json"], f.directory);
  const run = (args: string[]) =>
    runCli(["--db", f.path, "budget", ...args, "--json"], f.directory);
  expect(run(["activation", "start", "--month", "2026-11", "--review", review]).status).toBe(0);
  const date = new Date(),
    throughDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const facts = {
    startMonth: "2026-11",
    currency: "USD",
    opening: {
      accounts: [],
      categories: [{ categoryId: "food", availableCents: 0, evidence: "zero" }],
      readyToAssignCents: 0,
      evidence: "zero",
      deficitAcknowledged: false,
    },
    categories: [
      { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
    ],
    assignments: [],
    events: [],
  };
  const decision = {
    kind: "facts",
    facts,
    coverage: {
      throughDate,
      evidence: "complete",
      includedTransactionIds: [],
      postedBridgeEventIds: [],
    },
  };
  expect(
    run([
      "activation",
      "set",
      "--review",
      review,
      "--expected-review",
      "1",
      "--decision",
      JSON.stringify(decision),
    ]).status,
  ).toBe(0);
  const failed = run(["activation", "preview", "--review", review]);
  expect(failed.status, failed.stderr).toBe(2);
  expect(JSON.parse(failed.stderr).reason).toBe("missing-month-assignment");
});
