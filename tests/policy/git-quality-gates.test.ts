import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
function fixture(existing: boolean, format = "sha1") {
  const root = mkdtempSync(path.join(tmpdir(), "inab-gates-"));
  roots.push(root);
  git(root, ["init", "--quiet", `--object-format=${format}`]);
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

describe("local commit checks", { timeout: 30_000 }, () => {
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

const pushCommands = [
  ["check:push-state"],
  ["check"],
  ["check:tracked", "--tracked"],
  ["check:secrets", "--tracked"],
  ["check:secrets", "--staged"],
  ["check:secrets", "--history"],
];
function pushFixture(format = "sha1") {
  const root = fixture(false, format);
  const hook = path.join(project, ".husky/pre-push");
  if (existsSync(hook)) cpSync(hook, path.join(root, ".husky/pre-push"));
  mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules/.bin/tsx"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --import ${JSON.stringify(import.meta.resolve("tsx"))} "$@"\n`,
    { mode: 0o755 },
  );
  mkdirSync(path.join(root, "scripts/checks"), { recursive: true });
  cpSync(
    path.join(project, "scripts/check-git-state.ts"),
    path.join(root, "scripts/check-git-state.ts"),
  );
  cpSync(
    path.join(project, "scripts/checks/git-state.ts"),
    path.join(root, "scripts/checks/git-state.ts"),
  );
  const config = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  for (const name of ["check:push", "check:push-state"]) {
    const command = manifest.scripts[name];
    if (command !== undefined) config.scripts[name] = command;
  }
  config.scripts.check = `${JSON.stringify(process.execPath)} .git/record.mjs check`;
  config.scripts["check:push-state"] =
    `${JSON.stringify(process.execPath)} .git/record.mjs check:push-state`;
  writeFileSync(path.join(root, "package.json"), JSON.stringify(config));
  const recorder = path.join(root, ".git/record.mjs");
  writeFileSync(
    recorder,
    readFileSync(recorder, "utf8")
      .replace("import { appendFileSync }", "import { appendFileSync, readFileSync }")
      .replace(
        "const name = process.argv[2];",
        'const name = process.argv[2]; if (name === "check" && readFileSync(0, "utf8") !== "") process.exit(25);',
      )
      .replace(
        'if (name === "check:commit-state")',
        'if (name === "check:commit-state" || name === "check:push-state")',
      )
      .replace('"commit"],', 'name === "check:commit-state" ? "commit" : "push-clean"],'),
  );
  writeFileSync(path.join(root, ".gitignore"), ".husky/_/\nignored/\nnode_modules/\n");
  git(root, ["add", "."]);
  expect(
    git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "push fixture"]).status,
  ).toBe(0);
  const remote = mkdtempSync(path.join(tmpdir(), "inab-remote-"));
  roots.push(remote);
  expect(git(remote, ["init", "--bare", "--quiet", `--object-format=${format}`]).status).toBe(0);
  git(root, ["remote", "add", "synthetic", remote]);
  return { root, remote };
}
function push(root: string, refs: string[] = ["HEAD:refs/heads/example"], failure = "") {
  return spawnSync("/usr/bin/git", ["push", "synthetic", ...refs], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, INAB_FAIL_CHECK: failure },
  });
}
function hookInput(root: string, input: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      path.join(project, "scripts/check-git-state.ts"),
      "push-hook",
    ],
    { cwd: root, encoding: "utf8", input, timeout: 30_000 },
  );
}
function remoteRefs(remote: string) {
  return git(remote, ["show-ref"]).stdout;
}

describe("local push checks", { timeout: 30_000 }, () => {
  it("checks HEAD in exact publication order and allows ignored files", () => {
    const { root, remote } = pushFixture();
    mkdirSync(path.join(root, "ignored"));
    writeFileSync(path.join(root, "ignored/local"), "synthetic");
    const result = push(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded(root)).toEqual(pushCommands);
    expect(remoteRefs(remote)).toContain(git(root, ["rev-parse", "HEAD"]).stdout.trim());
  });
  it("fails safely when Git cannot list repository environment names", async () => {
    const { getPushCheckEnvironment } = await import("../../scripts/checks/git-state.ts");
    const root = mkdtempSync(path.join(tmpdir(), "inab-missing-environment-"));
    rmSync(root, { recursive: true });
    expect(getPushCheckEnvironment(root)).toEqual({
      ok: false,
      reason: "Git command failed while checking repository environment.",
    });
  });
  it("builds the child environment without changing the parent environment", async () => {
    const { getPushCheckEnvironment } = await import("../../scripts/checks/git-state.ts");
    const { root } = pushFixture();
    const before = { ...process.env };
    const result = getPushCheckEnvironment(root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.env).not.toBe(process.env);
    expect(result.env.PATH).toBe(before.PATH);
    expect(process.env).toEqual(before);
  });
  it("removes hook repository variables before checks and preserves the runtime environment", () => {
    const { root, remote } = pushFixture();
    const localNames = git(root, ["rev-parse", "--local-env-vars"]).stdout.trim().split("\n");
    const hook = path.join(root, ".husky/pre-push");
    const hookEnvironment = {
      GIT_DIR: path.join(root, ".git"),
      GIT_WORK_TREE: root,
      GIT_INDEX_FILE: path.join(root, ".git/index"),
      GIT_COMMON_DIR: path.join(root, ".git"),
    };
    writeFileSync(
      hook,
      Object.entries(hookEnvironment)
        .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
        .join("") + readFileSync(hook, "utf8"),
    );
    const recorder = path.join(root, ".git/record.mjs");
    writeFileSync(
      recorder,
      readFileSync(recorder, "utf8").replace(
        "const name = process.argv[2];",
        `const localNames = ${JSON.stringify(localNames)};
if (localNames.some((name) => Object.hasOwn(process.env, name))) {
  console.error("Repository environment reached publication checks.");
  process.exit(26);
}
if (process.env.INAB_RUNTIME_MARKER !== "preserved" || !process.env.PATH.endsWith(process.env.INAB_EXPECT_PATH)) process.exit(27);
const name = process.argv[2];`,
      ),
    );
    git(root, ["add", ".husky/pre-push"]);
    expect(
      git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "hook context"])
        .status,
    ).toBe(0);
    const result = spawnSync("/usr/bin/git", ["push", "synthetic", "HEAD:refs/heads/example"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, INAB_RUNTIME_MARKER: "preserved", INAB_EXPECT_PATH: process.env.PATH },
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded(root)).toEqual(pushCommands);
    expect(remoteRefs(remote)).toContain("refs/heads/example");
  });
  it.each(pushCommands.map((args, index) => [index, args.join(" ")]))(
    "stops at publication child %s (%s)",
    (index, command) => {
      const { root, remote } = pushFixture();
      const position = Number(index);
      const name = String(command).split(" ")[0] ?? "";
      // Secret invocations use a distinct failure argument below.
      const recorder = path.join(root, ".git/record.mjs");
      writeFileSync(
        recorder,
        readFileSync(recorder, "utf8").replace(
          "process.env.INAB_FAIL_CHECK === name",
          'process.env.INAB_FAIL_CHECK === process.argv.slice(2).join(" ")',
        ),
      );
      const before = remoteRefs(remote);
      const result = push(root, ["HEAD:refs/heads/example"], String(command));
      expect(result.status, name).not.toBe(0);
      expect(recorded(root)).toEqual(pushCommands.slice(0, position + 1));
      expect(remoteRefs(remote)).toBe(before);
    },
  );
  it.each(["staged", "unstaged", "untracked"])("rejects %s files before checks", (kind) => {
    const { root, remote } = pushFixture();
    if (kind === "staged") stage(root, "value.txt", "staged");
    else
      writeFileSync(path.join(root, kind === "unstaged" ? "value.txt" : "new file"), "synthetic");
    const before = snapshot(root);
    const result = push(root);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("clean");
    expect(existsSync(path.join(root, ".git/check-log"))).toBe(false);
    expect(remoteRefs(remote)).toBe("");
    expect(snapshot(root)).toEqual(before);
  });
  it("rejects every update whose tip differs from HEAD", () => {
    const { root, remote } = pushFixture();
    git(root, ["branch", "old"]);
    stage(root, "value.txt", "new");
    git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "new"]);
    expect(push(root, ["HEAD:refs/heads/current", "old:refs/heads/old"]).status).not.toBe(0);
    expect(remoteRefs(remote)).toBe("");
  });
  it("checks multiple HEAD updates once, skips deletion-only, and checks mixed updates", () => {
    const { root, remote } = pushFixture();
    expect(push(root, ["HEAD:refs/heads/one", "HEAD:refs/heads/two"]).status).toBe(0);
    expect(recorded(root)).toEqual(pushCommands);
    rmSync(path.join(root, ".git/check-log"));
    writeFileSync(path.join(root, "untracked"), "synthetic");
    expect(push(root, [":refs/heads/one"]).status).toBe(0);
    expect(existsSync(path.join(root, ".git/check-log"))).toBe(false);
    rmSync(path.join(root, "untracked"));
    expect(push(root, [":refs/heads/two", "HEAD:refs/heads/three"]).status).toBe(0);
    expect(recorded(root)).toEqual(pushCommands);
    expect(remoteRefs(remote)).toContain("refs/heads/three");
  });
  it.each([
    "garbage",
    "refs/heads/a invalid refs/heads/a invalid",
    `refs/heads/a ${"0".repeat(40)} invalid ${"0".repeat(40)}`,
    `refs/heads/a ${"0".repeat(39)} refs/heads/a ${"0".repeat(40)}`,
  ])("rejects malformed push input %s", (input) => {
    const { root } = pushFixture();
    expect(hookInput(root, input + "\n").status).not.toBe(0);
    expect(existsSync(path.join(root, ".git/check-log"))).toBe(false);
  });
  it.each(["sha1", "sha256"])("validates complete %s object IDs and deletion records", (format) => {
    const { root } = pushFixture(format);
    const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    const zero = "0".repeat(head.length);
    expect(hookInput(root, `(delete) ${zero} refs/heads/a ${head}\n`).status).toBe(0);
    for (const line of [
      `(delete) ${head} refs/heads/a ${zero}`,
      `refs/heads/a ${zero} refs/heads/a ${head}`,
      `(delete) ${zero.slice(1)} refs/heads/a ${head}`,
      `HEAD ${head} invalid ${zero}`,
    ]) {
      expect(hookInput(root, line + "\n").status).not.toBe(0);
    }
    const result = push(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(recorded(root)).toEqual(pushCommands);
  });
  it("treats empty hook input as a no-op", () => {
    const { root } = pushFixture();
    expect(hookInput(root, "").status).toBe(0);
    expect(existsSync(path.join(root, ".git/check-log"))).toBe(false);
  });
  it("fails if the hook executable dependency is absent", () => {
    const { root, remote } = pushFixture();
    rmSync(path.join(root, "node_modules"), { recursive: true });
    expect(push(root).status).not.toBe(0);
    expect(remoteRefs(remote)).toBe("");
  });
  it("fails if a publication child executable is absent", () => {
    const { root, remote } = pushFixture();
    const file = path.join(root, "package.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as { scripts: Record<string, string> };
    config.scripts.check = "inab-synthetic-missing-executable";
    stage(root, "package.json", JSON.stringify(config));
    git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "missing child"]);
    expect(push(root).status).not.toBe(0);
    expect(recorded(root)).toEqual([pushCommands[0]]);
    expect(remoteRefs(remote)).toBe("");
  });
  it("direct push checks refuse dirty and shallow repositories", () => {
    const { root } = pushFixture();
    writeFileSync(path.join(root, "untracked"), "synthetic");
    const direct = () =>
      spawnSync(process.execPath, [npm, "run", "check:push"], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
      });
    expect(direct().status).not.toBe(0);
    rmSync(path.join(root, "untracked"));
    const clone = mkdtempSync(path.join(tmpdir(), "inab-shallow-"));
    roots.push(clone);
    expect(git(clone, ["clone", "--quiet", "--depth=1", `file://${root}`, "."]).status).toBe(0);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.join(project, "scripts/check-git-state.ts"),
        "push-clean",
      ],
      { cwd: clone, encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("shallow");
  });
  it("permits real commit and push --no-verify bypasses", () => {
    const { root, remote } = pushFixture();
    stage(root, "value.txt", "bypass");
    writeFileSync(path.join(root, "untracked"), "synthetic");
    expect(git(root, ["commit", "--no-verify", "--quiet", "-m", "bypass"]).status).toBe(0);
    expect(git(root, ["push", "--no-verify", "synthetic", "HEAD:refs/heads/bypass"]).status).toBe(
      0,
    );
    expect(remoteRefs(remote)).toContain("refs/heads/bypass");
    expect(existsSync(path.join(root, ".git/check-log"))).toBe(false);
  });
});
