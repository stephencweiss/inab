import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
import { executeMigration } from "../../src/cli/imports.js";
import { parseSetupArguments } from "../../src/cli/setup-parse.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  fixtures.splice(0).forEach((fixture) => fixture.cleanup());
});
async function setup() {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const register = join(fixture.directory, "register.csv"),
    plan = join(fixture.directory, "plan.csv"),
    review = join(fixture.directory, "review.json");
  copyFileSync(fileURLToPath(new URL("../fixtures/ynab/register.csv", import.meta.url)), register);
  copyFileSync(fileURLToPath(new URL("../fixtures/ynab/plan.csv", import.meta.url)), plan);
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, "setup", "migrate", ...args, "--json"], fixture.directory);
  const preview = run(["preview", "--register", register, "--plan", plan, "--review", review]);
  expect(preview.status, preview.stderr).toBe(0);
  return { ...fixture, register, plan, review, run };
}
it("resumes private review across processes and rejects stale changes", async () => {
  const fixture = await setup();
  const changed = fixture.run([
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--name",
    "Demo cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "1",
  ]);
  expect(changed.status, changed.stderr).toBe(0);
  expect(JSON.parse(changed.stdout).revision).toBe(2);
  const resumed = fixture.run(["review", "--review", fixture.review]);
  expect(resumed.status, resumed.stderr).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({
    revision: 2,
    derived: { accounts: [{ name: "Demo cash" }] },
  });
  const stale = fixture.run([
    "acknowledge",
    "any",
    "--review",
    fixture.review,
    "--expected-review",
    "1",
  ]);
  expect(stale.status).toBe(4);
  expect(JSON.parse(stale.stderr).reason).toBe("stale-review");
});
it("offers guided review actions in a terminal and can stop without changes", async () => {
  const fixture = await setup();
  const ask = vi.fn(async () => "done");
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const value = await executeMigration(
    parseSetupArguments([
      "--db",
      fixture.path,
      "setup",
      "migrate",
      "review",
      "--review",
      fixture.review,
    ]),
    { interactive: true, ask },
  );
  expect(ask).toHaveBeenCalled();
  expect(value).toMatchObject({ revision: 1 });
});
