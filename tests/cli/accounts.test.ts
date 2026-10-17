import { afterEach, expect, it } from "vitest";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
async function setup() {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  return {
    ...fixture,
    run: (args: string[]) => runCli(["--db", fixture.path, "account", ...args], fixture.directory),
  };
}
it("creates, lists, inspects, renames, and corrects an account across CLI restarts", async () => {
  const { run } = await setup();
  const created = run([
    "add",
    "--name",
    "Synthetic",
    "--kind",
    "credit",
    "--opening",
    "-123.45",
    "--as-of",
    "2026-10-16",
    "--confirm",
    "--json",
  ]);
  expect(created.status, created.stderr).toBe(0);
  expect(created.stderr).toBe("");
  const result = JSON.parse(created.stdout);
  const id = result.account.id;
  expect(result).toMatchObject({
    ok: true,
    operationId: expect.any(String),
    account: { name: "Synthetic", kind: "credit", openingCents: -12345, revision: 1 },
  });
  expect(JSON.parse(run(["list", "--json"]).stdout).accounts).toHaveLength(1);
  expect(JSON.parse(run(["show", id, "--json"]).stdout).account.id).toBe(id);
  const rename = run([
    "rename",
    id,
    "--name",
    "Renamed",
    "--expected-version",
    "1",
    "--confirm",
    "--json",
  ]);
  expect(rename.status, rename.stderr).toBe(0);
  expect(JSON.parse(rename.stdout).account).toMatchObject({ id, name: "Renamed", revision: 2 });
  expect(
    run([
      "opening",
      id,
      "--amount",
      "0",
      "--as-of",
      "2026-10-15",
      "--expected-version",
      "1",
      "--confirm",
      "--json",
    ]).status,
  ).toBe(4);
  const corrected = run([
    "opening",
    id,
    "--amount",
    "0",
    "--as-of",
    "2026-10-15",
    "--expected-version",
    "2",
    "--confirm",
    "--json",
  ]);
  expect(corrected.status, corrected.stderr).toBe(0);
  expect(JSON.parse(corrected.stdout).account).toMatchObject({ id, revision: 3, openingCents: 0 });
  expect(run(["show", "Synthetic", "--json"]).status).toBe(3);
});
it("Tracking has no opening pair or recorded balance", async () => {
  const { run } = await setup();
  const added = run([
    "add",
    "--name",
    "Synthetic tracking",
    "--kind",
    "tracking",
    "--confirm",
    "--json",
  ]);
  expect(added.status, added.stderr).toBe(0);
  const id = JSON.parse(added.stdout).account.id;
  expect(JSON.parse(added.stdout).account).toMatchObject({ openingCents: null, openingDate: null });
  expect(run(["show", id]).stdout).toContain("no balance recorded");
  expect(
    run(["add", "--name", "Invalid", "--kind", "tracking", "--opening", "0", "--confirm"]).status,
  ).toBe(2);
});
it.each(
  [
    ["add"],
    ["add", "--name", "x", "--kind", "cash", "--opening", "0", "--as-of", "bad", "--confirm"],
    [
      "add",
      "--name",
      " ",
      "--kind",
      "cash",
      "--opening",
      "0",
      "--as-of",
      "2026-10-16",
      "--confirm",
    ],
    ["add", "--name", "x", "--kind", "cash", "--opening", "0", "--currency", "EUR", "--confirm"],
    ["list", "--typo"],
    ["list", "--json", "--json"],
    ["show"],
    ["rename", "missing", "--name", "x", "--confirm"],
    ["add", "--name", "x", "--name", "y"],
    ["add", "--name", "x", "--kind", "cash", "--opening", "0"],
  ].map((args) => ({ args })),
)("rejects invalid input without mutation or prompt waits: $args", async ({ args }) => {
  const { run } = await setup();
  expect(run(args).status, JSON.stringify(args)).toBe(2);
  expect(JSON.parse(run(["list", "--json"]).stdout).accounts).toEqual([]);
});
it("human previews show target and exact signed opening values", async () => {
  const { run, path } = await setup();
  const added = run([
    "add",
    "--name",
    "Synthetic",
    "--kind",
    "cash",
    "--opening",
    "-12.34",
    "--as-of",
    "2026-10-16",
    "--confirm",
  ]);
  expect(added.status, added.stderr).toBe(0);
  expect(added.stderr).toContain(path);
  expect(added.stderr).toContain("-12.34");
  expect(added.stderr).toContain("2026-10-16");
  expect(added.stdout).toContain("revision 1");
});
it("accepts the exact planned account command flags and requires a date in scripts", async () => {
  const { run } = await setup();
  const added = run([
    "add",
    "--name",
    "Canonical",
    "--kind",
    "cash",
    "--opening",
    "12.34",
    "--as-of",
    "2026-10-16",
    "--confirm",
    "--json",
  ]);
  expect(added.status, added.stderr).toBe(0);
  const id = JSON.parse(added.stdout).account.id;
  const corrected = run([
    "opening",
    id,
    "--amount",
    "56.78",
    "--as-of",
    "2026-10-15",
    "--expected-version",
    "1",
    "--confirm",
    "--json",
  ]);
  expect(corrected.status, corrected.stderr).toBe(0);
  expect(JSON.parse(corrected.stdout).account).toMatchObject({
    openingCents: 5678,
    openingDate: "2026-10-15",
  });
  expect(
    run(["add", "--name", "Needs date", "--kind", "cash", "--opening", "0", "--confirm"]).status,
  ).toBe(2);
});
it("reports operation ID for storage failure and leaves account/history atomic", async () => {
  const { run, path } = await setup();
  const connection = openDatabase(path);
  try {
    connection.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'synthetic history failure'); END",
    );
    const result = run([
      "add",
      "--name",
      "Synthetic failed",
      "--kind",
      "cash",
      "--opening",
      "0",
      "--as-of",
      "2026-10-16",
      "--confirm",
      "--json",
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Operation ID: [0-9a-f-]{36}/);
    expect(connection.sqlite.prepare("SELECT COUNT(*) AS count FROM accounts").get()).toEqual({
      count: 0,
    });
    expect(connection.sqlite.prepare("SELECT COUNT(*) AS count FROM changes").get()).toEqual({
      count: 0,
    });
  } finally {
    connection.sqlite.close();
  }
});
it("shows working, cleared, and uncleared USD amounts in human account inspection", async () => {
  const { run } = await setup();
  const added = run([
    "add",
    "--name",
    "Synthetic balance",
    "--kind",
    "credit",
    "--opening",
    "-12.34",
    "--as-of",
    "2026-10-16",
    "--confirm",
    "--json",
  ]);
  expect(added.status).toBe(0);
  const id = JSON.parse(added.stdout).account.id;
  const shown = run(["show", id]);
  expect(shown.status).toBe(0);
  expect(shown.stdout).toContain("Working USD -12.34");
  expect(shown.stdout).toContain("Cleared USD -12.34");
  expect(shown.stdout).toContain("Uncleared USD 0.00");
});
