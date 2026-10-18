import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blockedCandidateFiles } from "../../scripts/checks/tracked-paths.ts";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "inab-private-"));
  roots.push(root);
  execFileSync("/usr/bin/git", ["init", "--quiet", root]);
  writeFileSync(path.join(root, ".gitignore"), "*.sqlite\nynab-export/\n");
  return root;
}
function add(root: string, file: string, contents = "synthetic fixture\n"): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents);
  execFileSync("/usr/bin/git", ["add", "--force", "--", file], { cwd: root });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("private file policy", () => {
  it.each(["staged", "tracked"] as const)("rejects forced ignored paths in %s mode", (mode) => {
    const root = fixture();
    add(root, "synthetic account\nfile.sqlite");
    add(root, "ynab-export/synthetic export.csv");
    expect(blockedCandidateFiles(root, mode)).toEqual([
      "synthetic account\nfile.sqlite",
      "ynab-export/synthetic export.csv",
    ]);
  });
  it("allows generated synthetic fixture JSON", () => {
    const root = fixture();
    add(
      root,
      "tests/fixtures/accounts.json",
      JSON.stringify({ accounts: [{ id: "synthetic-account", name: "Test cash" }] }),
    );
    expect(blockedCandidateFiles(root, "staged")).toEqual([]);
  });
  it("keeps complete tracked mode separate from staged changes", () => {
    const root = fixture();
    add(root, "synthetic.sqlite");
    execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "synthetic",
      ],
      { cwd: root },
    );
    expect(blockedCandidateFiles(root, "staged")).toEqual([]);
    expect(blockedCandidateFiles(root, "tracked")).toEqual(["synthetic.sqlite"]);
  });
  it("rejects a staged type change but permits a staged deletion", () => {
    const root = fixture();
    add(root, "synthetic.sqlite");
    execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "synthetic",
      ],
      { cwd: root },
    );
    rmSync(path.join(root, "synthetic.sqlite"));
    symlinkSync("synthetic-target", path.join(root, "synthetic.sqlite"));
    execFileSync("/usr/bin/git", ["add", "--force", "--", "synthetic.sqlite"], { cwd: root });
    expect(blockedCandidateFiles(root, "staged")).toEqual(["synthetic.sqlite"]);
    execFileSync("/usr/bin/git", ["rm", "--force", "--", "synthetic.sqlite"], { cwd: root });
    expect(blockedCandidateFiles(root, "staged")).toEqual([]);
  });
  it("supports explicit staged command mode", () => {
    const root = fixture();
    add(root, "synthetic.sqlite");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.resolve("scripts/check-tracked-paths.ts"),
        "--staged",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("synthetic.sqlite is a private path");
  });
});
