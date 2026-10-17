import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((value) => value.cleanup()));
it("requires explicit target, confirmation, and rejects unknown flags", () => {
  const value = temporaryDatabase();
  fixtures.push(value);
  for (const args of [
    ["init"],
    ["--db", value.path, "init"],
    ["--db", value.path, "init", "--confirm", "--typo"],
  ]) {
    expect(runCli(args, value.directory).status).toBe(2);
    expect(existsSync(value.path)).toBe(false);
  }
});
it("initializes and restarts from a different working directory with clean JSON", () => {
  const value = temporaryDatabase();
  fixtures.push(value);
  for (let index = 0; index < 2; index++) {
    const result = runCli(["--db", value.path, "init", "--confirm", "--json"], value.directory);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, database: value.path, schemaVersion: 2 });
    expect(result.stderr).toBe("");
  }
});

it("runs the built CLI and bundled migration metadata from outside the repository", () => {
  const value = temporaryDatabase();
  fixtures.push(value);
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const npmPath = process.env.npm_execpath;
  if (!npmPath) throw new Error("Run tests with npm test");
  const build = spawnSync(process.execPath, [npmPath, "run", "build"], {
    cwd: repository,
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(build.status, build.stderr).toBe(0);
  const bundle = `${value.directory}/bundle`;
  cpSync(new URL("../../dist/", import.meta.url), bundle, { recursive: true });
  writeFileSync(`${bundle}/package.json`, '{"type":"module"}');
  symlinkSync(`${repository}/node_modules`, `${bundle}/node_modules`, "dir");
  const executable = `${bundle}/cli/main.js`;
  for (let index = 0; index < 2; index++) {
    const result = spawnSync(
      process.execPath,
      [executable, "--db", value.path, "init", "--confirm", "--json"],
      { cwd: value.directory, encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, database: value.path, schemaVersion: 2 });
  }
}, 30_000);

it("shows the explicit init target before a human-readable write", () => {
  const value = temporaryDatabase();
  fixtures.push(value);
  const result = runCli(["--db", value.path, "init", "--confirm"], value.directory);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(`Init target: ${value.path}\n`);
  expect(result.stdout).toContain(`Initialized database: ${value.path}`);
});

it("migrates only an explicit existing database", () => {
  const value = temporaryDatabase();
  fixtures.push(value);
  const entry = fileURLToPath(new URL("../../src/cli/migrate.ts", import.meta.url));
  const loader = import.meta.resolve("tsx");
  const runMigration = (args: string[]) =>
    spawnSync(process.execPath, ["--import", loader, entry, ...args], {
      cwd: value.directory,
      encoding: "utf8",
      timeout: 10_000,
    });
  expect(runMigration([]).status).toBe(2);
  expect(runMigration(["--db", value.path, "--unknown"]).status).toBe(2);
  expect(runMigration(["--db", value.path]).status).toBe(1);
  expect(existsSync(value.path)).toBe(false);
  expect(runCli(["--db", value.path, "init", "--confirm", "--json"], value.directory).status).toBe(
    0,
  );
  const result = runMigration(["--db", value.path]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(`Migration target: ${value.path}\n`);
  expect(JSON.parse(result.stdout)).toEqual({ ok: true, database: value.path, schemaVersion: 2 });
});
