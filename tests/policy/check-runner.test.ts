import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runChecks, CHECKS } from "../../scripts/checks/runner.ts";

describe("full check runner", () => {
  it("forwards the first failure and stops before later success", () => {
    const visited: string[] = [];
    const result = runChecks((name) => {
      visited.push(name);
      return name === "check:tracked" ? 7 : 0;
    });
    expect(result).toBe(7);
    expect(visited).toEqual(["check:documents", "check:tracked"]);
  });
  it("forwards a real child exit code and stops launching later checks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "inab-runner-"));
    try {
      const child = path.join(root, "npm.mjs");
      writeFileSync(
        child,
        'const name = process.argv[3]; console.log(name); process.exit(name === "check:tracked" ? 7 : 0);',
      );
      const result = spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), path.resolve("scripts/check.ts")],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, npm_execpath: child },
        },
      );
      expect(result.status).toBe(7);
      expect(result.stdout.trim().split("\n")).toEqual(["check:documents", "check:tracked"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("runs every installed check including secrets and build", () => {
    const visited: string[] = [];
    expect(
      runChecks((name) => {
        visited.push(name);
        return 0;
      }),
    ).toBe(0);
    expect(visited).toEqual([
      "check:documents",
      "check:tracked",
      "check:boundaries",
      "check:format",
      "lint",
      "typecheck",
      "test",
      "check:secrets",
      "build",
    ]);
    expect(CHECKS).toEqual(visited);
  });
});
