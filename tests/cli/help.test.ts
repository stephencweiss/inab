import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/cli.js";

let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "inab-cli-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("terminal help", () => {
  it("shows planned manual-account commands without creating a database", () => {
    const result = runCli(["--help"], directory);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: inab");
    expect(result.stdout).toContain("account add");
    expect(result.stdout).toContain("transaction add");
    expect(result.stdout).toContain("reconcile");
    expect(result.stdout).toContain("snapshot add");
    expect(result.stdout).toContain("not available yet");
    expect(result.stderr).toBe("");
    expect(readdirSync(directory)).toEqual([]);
  });

  it.each([["unknown"], ["--unknown"], ["--help", "--unknown"]])(
    "rejects invalid arguments %j without creating a database",
    (...args) => {
      const result = runCli(args, directory);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Use --help");
      expect(readdirSync(directory)).toEqual([]);
    },
  );
});
