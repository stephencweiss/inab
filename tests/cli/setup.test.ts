import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()));
it("shows setup status, requires confirmation, and closes empty setup", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, ...args, "--json"], fixture.directory);
  const status = run(["setup", "status"]);
  expect(status.status, status.stderr).toBe(0);
  expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, state: "open" });
  const refused = run(["setup", "fresh"]);
  expect(refused.status).toBe(2);
  expect(JSON.parse(refused.stderr).ok).toBe(false);
  const fresh = run(["setup", "fresh", "--confirm"]);
  expect(fresh.status, fresh.stderr).toBe(0);
  expect(JSON.parse(fresh.stdout)).toMatchObject({ ok: true, state: "fresh" });
  expect(JSON.parse(run(["setup", "status"]).stdout).state).toBe("fresh");
});
it("keeps setup errors structured and requires an explicit database", () => {
  const result = runCli(["setup", "status", "--json"], "/tmp");
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toMatchObject({ ok: false });
});
it("requires an existing regular database for setup and migration", async () => {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, ...args, "--json"], fixture.directory);
  for (const args of [
    ["setup", "status"],
    [
      "setup",
      "migrate",
      "preview",
      "--register",
      "source.csv",
      "--plan",
      "plan.csv",
      "--review",
      "review.json",
    ],
  ]) {
    const result = run(args);
    expect(result.status, result.stderr).toBe(3);
    expect(JSON.parse(result.stderr).reason).toBe("source-or-target-missing");
  }
  expect(existsSync(fixture.path)).toBe(false);
  const directory = runCli(
    ["--db", fixture.directory, "setup", "status", "--json"],
    fixture.directory,
  );
  expect(directory.status, directory.stderr).toBe(2);
  expect(JSON.parse(directory.stderr).reason).toBe("invalid-path");
  await initializeDatabase(fixture.path);
  const alias = join(fixture.directory, "alias.sqlite");
  symlinkSync(fixture.path, alias);
  const linked = runCli(["--db", alias, "setup", "status", "--json"], fixture.directory);
  expect(linked.status, linked.stderr).toBe(2);
  expect(JSON.parse(linked.stderr).reason).toBe("invalid-path");
});
