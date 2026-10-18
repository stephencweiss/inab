import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const project = process.cwd();
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const commands = [
  "check:documents",
  "check:tracked",
  "check:secrets",
  "check:commit-state",
  "lint",
  "typecheck",
  "test:unit",
];
const npm = process.env.npm_execpath;
if (npm === undefined) throw new Error("Run policy tests with npm test.");

function git(root: string, args: string[]) {
  return spawnSync("/usr/bin/git", args, { cwd: root, encoding: "utf8", timeout: 20_000 });
}
function stage(root: string, file: string, content: string) {
  writeFileSync(path.join(root, file), content);
  execFileSync("/usr/bin/git", ["add", "--", file], { cwd: root });
}
function fixture(existing: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), "inab-gates-"));
  roots.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Synthetic"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(root, ".husky"));
  cpSync(path.join(project, ".husky/pre-commit"), path.join(root, ".husky/pre-commit"));
  const installed = spawnSync(process.execPath, [path.join(project, "node_modules/husky/bin.js")], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(installed.status).toBe(0);
  const scripts: Record<string, string> = {};
  for (const name of ["check:commit", "check:quick"]) {
    const command = manifest.scripts[name];
    if (command !== undefined) scripts[name] = command;
  }
  for (const name of commands)
    scripts[name] = `${JSON.stringify(process.execPath)} .git/record.mjs ${name}`;
  writeFileSync(
    path.join(root, ".git/record.mjs"),
    `
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const name = process.argv[2];
appendFileSync(".git/check-log", JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.INAB_FAIL_CHECK === name) process.exit(23);
if (name === "check:commit-state") {
  const result = spawnSync(process.execPath, ["--import", ${JSON.stringify(import.meta.resolve("tsx"))}, ${JSON.stringify(path.join(project, "scripts/check-git-state.ts"))}, "commit"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
`,
  );
  stage(root, ".gitignore", ".husky/_/\nignored/\n");
  stage(root, "package.json", JSON.stringify({ type: "module", scripts }));
  execFileSync("/usr/bin/git", ["add", ".husky/pre-commit"], { cwd: root });
  stage(root, "value.txt", "initial\n");
  if (existing) {
    const result = git(root, [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "fixture baseline",
    ]);
    expect(result.status).toBe(0);
    stage(root, "value.txt", "staged\n");
  }
  return root;
}
function commit(root: string, failed: string = "") {
  return spawnSync("/usr/bin/git", ["commit", "--quiet", "-m", "synthetic check"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, INAB_FAIL_CHECK: failed },
  });
}
function recorded(root: string) {
  return readFileSync(path.join(root, ".git/check-log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}
function snapshot(root: string) {
  return {
    head: git(root, ["rev-parse", "--verify", "HEAD"]).stdout,
    index: git(root, ["ls-files", "--stage", "-z"]).stdout,
    status: git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout,
    file: readFileSync(path.join(root, "value.txt"), "utf8"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local commit checks", () => {
  it.each([false, true])(
    "commits a clean staged revision with existing HEAD=%s in exact order",
    (existing) => {
      const root = fixture(existing);
      const result = commit(root);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(recorded(root)).toEqual(
        commands.map((name) => [
          name,
          ...(["check:tracked", "check:secrets"].includes(name) ? ["--staged"] : []),
        ]),
      );
    },
  );
  it("keeps the quick command as a commit alias and the full test command intact", () => {
    expect(manifest.scripts["check:quick"]).toBe("npm run check:commit");
    expect(manifest.scripts["test:unit"]).toBe("vitest run tests/unit");
    expect(manifest.scripts.test).toBe("vitest run");
  });
  it.each(["unstaged", "untracked"])(
    "refuses %s work and preserves HEAD, index, and working files",
    (kind) => {
      const root = fixture(true);
      if (kind === "unstaged") writeFileSync(path.join(root, "value.txt"), "working\n");
      else writeFileSync(path.join(root, "new\nfile with spaces.txt"), "untracked\n");
      const before = snapshot(root);
      const result = commit(root);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        kind === "unstaged" ? "unstaged" : "untracked",
      );
      expect(recorded(root).map((entry) => entry[0])).toEqual(commands.slice(0, 4));
      expect(snapshot(root)).toEqual(before);
    },
  );
  it("allows ignored files", () => {
    const root = fixture(true);
    mkdirSync(path.join(root, "ignored"));
    writeFileSync(path.join(root, "ignored/local.txt"), "synthetic ignored data");
    const result = commit(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it.each(commands)("stops after failed %s without changing user work", (name) => {
    const root = fixture(true);
    const before = snapshot(root);
    const result = commit(root, name);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("23");
    expect(recorded(root).map((entry) => entry[0])).toEqual(
      commands.slice(0, commands.indexOf(name) + 1),
    );
    expect(snapshot(root)).toEqual(before);
  });
  it.each(["missing script", "missing executable"])(
    "fails when a required child has a %s",
    (kind) => {
      const root = fixture(true);
      const file = path.join(root, "package.json");
      const value = JSON.parse(readFileSync(file, "utf8")) as { scripts: Record<string, string> };
      if (kind === "missing script") delete value.scripts.typecheck;
      else value.scripts.typecheck = "inab-synthetic-missing-executable";
      stage(root, "package.json", JSON.stringify(value));
      const before = snapshot(root);
      expect(commit(root).status).not.toBe(0);
      expect(recorded(root).map((entry) => entry[0])).toEqual(commands.slice(0, 5));
      expect(snapshot(root)).toEqual(before);
    },
  );
  it("fails safely if the Git child cannot start", async () => {
    const { checkCommitState } = await import("../../scripts/checks/git-state.ts");
    const root = mkdtempSync(path.join(tmpdir(), "inab-missing-root-"));
    rmSync(root, { recursive: true });
    expect(checkCommitState(root)).toEqual({
      ok: false,
      reason: "Git command failed while checking unstaged changes.",
    });
  });
  it("reports Git command errors separately from differences", () => {
    const root = mkdtempSync(path.join(tmpdir(), "inab-no-git-"));
    roots.push(root);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.join(project, "scripts/check-git-state.ts"),
        "commit",
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Git command failed");
  });
});
