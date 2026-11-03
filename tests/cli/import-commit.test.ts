import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { migrationApplication } from "../../src/bootstrap.js";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
import {
  csvText,
  registerFields,
  registerHeaders,
  planFields,
  planHeaders,
} from "../helpers/ynab.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
it("requires confirmation, commits a ready review once, and refuses another migration", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const register = join(fixture.directory, "register.csv"),
    plan = join(fixture.directory, "plan.csv"),
    review = join(fixture.directory, "review.json");
  writeFileSync(register, csvText(registerHeaders, [registerFields()]));
  writeFileSync(plan, csvText(planHeaders, [planFields()]));
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
  expect(view.derived.ready, JSON.stringify(view.derived.issues)).toBe(true);
  const run = (extra: string[]) =>
    runCli(
      [
        "--db",
        fixture.path,
        "setup",
        "migrate",
        "commit",
        "--review",
        review,
        "--expected-review",
        String(view.revision),
        ...extra,
        "--json",
      ],
      fixture.directory,
    );
  expect(run([]).status).toBe(2);
  const committed = run(["--confirm"]);
  expect(committed.status, committed.stderr).toBe(0);
  expect(JSON.parse(committed.stdout).reused).toBe(false);
  const repeat = run(["--confirm"]);
  expect(repeat.status, repeat.stderr).toBe(0);
  expect(JSON.parse(repeat.stdout).reused).toBe(true);
  const closed = runCli(
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
      join(fixture.directory, "another.json"),
      "--json",
    ],
    fixture.directory,
  );
  expect(closed.status).toBe(4);
  expect(JSON.parse(closed.stderr).reason).toBe("setup-closed");
});
