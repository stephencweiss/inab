import { afterEach, expect, it } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
it("records the running example and distinct identical purchases through restarted CLI processes", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) => runCli(["--db", f.path, ...args], f.directory);
  const account = run([
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
  const id = JSON.parse(account.stdout).account.id;
  const args = [
    "transaction",
    "add",
    "--account",
    id,
    "--date",
    "2026-10-17",
    "--amount",
    "-60",
    "--payee",
    "Synthetic",
    "--confirm",
    "--json",
  ];
  const pending = run(args);
  expect(pending.status, pending.stderr).toBe(0);
  const posted = run([...args.slice(0, 7), "-25", ...args.slice(8), "--posted-on", "2026-10-17"]);
  expect(posted.status, posted.stderr).toBe(0);
  const register = run(["register", id, "--json"]);
  expect(register.status, register.stderr).toBe(0);
  expect(JSON.parse(register.stdout)).toMatchObject({
    balances: { workingCents: 91500, clearedCents: 97500, unclearedCents: -6000 },
  });
  const duplicate = run(args);
  expect(JSON.parse(duplicate.stdout).transaction.id).not.toBe(
    JSON.parse(pending.stdout).transaction.id,
  );
  expect(run(["transaction", "add"]).status).toBe(2);
});
it("edits, clears, and unclears with complete flags and rejects invalid script input", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const run = (args: string[]) => runCli(["--db", f.path, ...args], f.directory);
  const created = run([
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
  const accountId = JSON.parse(created.stdout).account.id;
  const base = [
    "transaction",
    "add",
    "--account",
    accountId,
    "--date",
    "2026-10-17",
    "--amount",
    "200",
    "--payee",
    "Synthetic",
    "--confirm",
    "--json",
  ];
  const added = run(base);
  expect(added.status, added.stderr).toBe(0);
  const id = JSON.parse(added.stdout).transaction.id;
  for (const args of [
    [
      "transaction",
      "edit",
      id,
      "--date",
      "2026-10-17",
      "--amount",
      "150",
      "--payee",
      "Corrected",
      "--memo",
      "",
      "--expected-version",
      "1",
    ],
    ["transaction", "clear", id, "--posted-on", "2026-10-17", "--expected-version", "2"],
    ["transaction", "unclear", id, "--expected-version", "3"],
  ]) {
    const result = run([...args, "--confirm", "--json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).transaction.id).toBe(id);
  }
  expect(JSON.parse(run(["register", accountId, "--json"]).stdout)).toMatchObject({
    balances: { workingCents: 5000, clearedCents: -10000, unclearedCents: 15000 },
  });
  for (const args of [
    ["transaction", "add"],
    ["transaction", "clear", id, "--posted-on", "2026-10-17"],
    [...base, "--amount", "1"],
    [...base, "--currency", "EUR"],
    [...base, "--typo"],
    ["transaction", "edit", id, "--posted-on", "2026-10-17"],
    ["register", accountId, "--confirm"],
  ])
    expect(run(args).status, JSON.stringify(args)).toBe(2);
  for (const amount of ["0", "1.001", "90071992547409.92"]) {
    const args = [...base];
    args[7] = amount;
    expect(run(args).status).toBe(2);
  }
  const future = [...base];
  future[5] = "9999-01-01";
  const refused = run(future);
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain("Scheduled");
  expect(run(["transaction", "unclear", id, "--expected-version", "1", "--confirm"]).status).toBe(
    4,
  );
  expect(
    run(["transaction", "unclear", "missing", "--expected-version", "1", "--confirm"]).status,
  ).toBe(3);
  const tracking = run([
    "account",
    "add",
    "--name",
    "Synthetic tracking",
    "--kind",
    "tracking",
    "--confirm",
    "--json",
  ]);
  const trackingId = JSON.parse(tracking.stdout).account.id;
  const trackingArgs = [...base];
  trackingArgs[3] = trackingId;
  expect(run(trackingArgs).stderr).toContain("not supported in Slice 1");
  expect(run(["register", trackingId]).status).toBe(2);
}, 30000);
