import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrationApplication } from "../../src/bootstrap.js";
import {
  csvText,
  registerFields,
  registerHeaders,
  planFields,
  planHeaders,
} from "../helpers/ynab.js";
import { afterEach, expect, it } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
it("returns empty imported accounts and rejects invalid history pages and months", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, "import", "history", ...args, "--json"], fixture.directory);
  const accounts = run(["accounts"]);
  expect(accounts.status, accounts.stderr).toBe(0);
  expect(JSON.parse(accounts.stdout)).toEqual({ ok: true, accounts: [] });
  for (const args of [
    ["plan", "--month", "2026-13"],
    ["plan", "--month", "2026-10", "--limit", "1001"],
    ["register", "missing", "--offset", "-1"],
  ])
    expect(run(args).status).toBe(2);
  const report = run(["report", "missing"]);
  expect(report.status).toBe(3);
  expect(JSON.parse(report.stderr).reason).toBe("import-unavailable");
});

it("reads imported duplicate rows, plan observations, and stored report through the CLI", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const register = join(fixture.directory, "register.csv"),
    plan = join(fixture.directory, "plan.csv"),
    review = join(fixture.directory, "review.json");
  writeFileSync(register, csvText(registerHeaders, [registerFields(), registerFields()]));
  writeFileSync(plan, csvText(planHeaders, [planFields(), planFields()]));
  const app = migrationApplication(fixture.path);
  let view = app.preview({ registerPath: register, planPath: plan, reviewPath: review });
  view = await app.change(review, view.revision, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Demo cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(review, view.revision, {
    tag: "opening",
    accountKey: "account:1",
    date: "2026-10-21",
    cents: 10000,
  });
  for (const issue of view.derived.issues)
    view = await app.change(review, view.revision, { tag: "ack", key: issue.key });
  const receipt = await app.commit(review, view.revision);
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, "import", "history", ...args, "--json"], fixture.directory);
  const accounts = run(["accounts"]);
  expect(accounts.status, accounts.stderr).toBe(0);
  const account = JSON.parse(accounts.stdout).accounts[0];
  const history = run(["register", account.accountId, "--limit", "1", "--offset", "1"]);
  expect(history.status, history.stderr).toBe(0);
  expect(JSON.parse(history.stdout).history.unverified).toHaveLength(1);
  const monthly = run(["plan", "--month", "2026-10"]);
  expect(monthly.status, monthly.stderr).toBe(0);
  expect(JSON.parse(monthly.stdout).history.rows).toHaveLength(2);
  const report = run(["report", receipt.importId]);
  expect(report.status, report.stderr).toBe(0);
  expect(JSON.parse(report.stdout).report.importId).toBe(receipt.importId);
});
