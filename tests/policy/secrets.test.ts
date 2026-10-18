import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = path.resolve("scripts/check-secrets.ts");
/** Invalid JSON credential fixture: no key bytes or valid credential values exist. */
const synthetic = JSON.stringify({
  private_key_id: "INAB-SYNTHETIC-INVALID-ID",
  private_key: "-----BEGIN " + "RSA PRIVATE KEY----- INAB SYNTHETIC INVALID KEY",
});
function git(root: string, args: string[]): string {
  return execFileSync("/usr/bin/git", args, { cwd: root, encoding: "utf8" });
}
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "inab-secrets-"));
  roots.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Synthetic"]);
  git(root, ["config", "user.email", "synthetic@example.invalid"]);
  return root;
}
function stage(root: string, file: string, content: string): void {
  writeFileSync(path.join(root, file), content);
  git(root, ["add", "--", file]);
}
function commit(root: string): void {
  git(root, ["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "synthetic"]);
}
function scan(root: string, mode: string) {
  return spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), script, ...(mode === "" ? [] : [mode])],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}
function runHook(root: string) {
  const shim = path.join(root, "npm");
  const project = process.cwd();
  writeFileSync(
    shim,
    `#!${process.execPath}
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const project = ${JSON.stringify(project)};
const name = process.argv[3];
let result;
if (name === "check:quick") {
  const command = JSON.parse(readFileSync(project + "/package.json", "utf8")).scripts[name];
  result = spawnSync("/bin/sh", ["-c", command], { stdio: "inherit" });
} else if (name === "check:documents" || name === "lint") {
  console.log(name);
  process.exit(0);
} else if (name === "check:tracked" || name === "check:secrets") {
  const file = name === "check:tracked" ? "check-tracked-paths.ts" : "check-secrets.ts";
  result = spawnSync(process.execPath, ["--import", ${JSON.stringify(import.meta.resolve("tsx"))}, project + "/scripts/" + file, ...process.argv.slice(4).filter((argument) => argument !== "--")], { stdio: "inherit" });
} else { process.exit(9); }
process.exit(result.status ?? 1);
`,
  );
  chmodSync(shim, 0o700);
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  return spawnSync("/bin/sh", ["-c", readFileSync(".husky/pre-commit", "utf8")], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` },
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("Git secret scans", () => {
  it("checks added index blobs even when working files are clean", () => {
    const root = fixture();
    const file = "added with\nspace.json";
    stage(root, file, synthetic);
    writeFileSync(path.join(root, file), "safe");
    const result = scan(root, "--staged");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("@secretlint/secretlint-rule-gcp");
    expect(result.stdout).not.toContain("INAB-SYNTHETIC-INVALID-ID");
  });
  it("checks modified and renamed blobs and permits deletion", () => {
    const root = fixture();
    stage(root, "original.json", "safe");
    commit(root);
    stage(root, "original.json", synthetic);
    expect(scan(root, "--staged").status).toBe(1);
    git(root, ["mv", "--", "original.json", "renamed.json"]);
    expect(scan(root, "--staged").status).toBe(1);
    git(root, ["rm", "--force", "--", "renamed.json"]);
    expect(scan(root, "--staged").status).toBe(0);
  });
  it("checks all tracked index blobs, including lockfiles, but excludes unstaged contents", () => {
    const root = fixture();
    stage(root, "package-lock.json", synthetic);
    commit(root);
    writeFileSync(path.join(root, "package-lock.json"), "safe");
    expect(scan(root, "--staged").status).toBe(0);
    expect(scan(root, "--tracked").status).toBe(1);
    stage(root, "package-lock.json", "safe");
    writeFileSync(path.join(root, "package-lock.json"), synthetic);
    expect(scan(root, "--tracked").status).toBe(0);
  });
  it("finds a deleted historical secret with the same scanner", () => {
    const root = fixture();
    stage(root, "old\nkey.json", synthetic);
    commit(root);
    git(root, ["rm", "--", "old\nkey.json"]);
    commit(root);
    expect(scan(root, "--tracked").status).toBe(0);
    expect(scan(root, "--history").status).toBe(1);
  });
  it("does not read external contents through candidate symlinks", () => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(path.join(outside, "external.json"), synthetic);
    symlinkSync(path.join(outside, "external.json"), path.join(root, "link.json"));
    const result = scan(root, "");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Secret scan failed");
  });
  it.each(["scanner", "preset"])(
    "fails clearly when the pinned %s is unavailable, even with no staged files",
    (missing) => {
      const root = fixture();
      mkdirSync(path.join(root, "scripts"));
      cpSync(path.resolve("scripts/checks"), path.join(root, "scripts/checks"), {
        recursive: true,
      });
      cpSync(script, path.join(root, "scripts/check-secrets.ts"));
      writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
      if (missing === "preset") {
        symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
        writeFileSync(
          path.join(root, ".secretlintrc.json"),
          '{"rules":[{"id":"@secretlint/inab-synthetic-missing-preset"}]}',
        );
      }
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          path.join(root, "scripts/check-secrets.ts"),
          "--staged",
        ],
        { cwd: root, encoding: "utf8", timeout: 10_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Secret scan failed. Install pinned dependencies with npm ci",
      );
    },
  );
  it("runs installed hook commands against staged paths and staged secret bytes before lint", () => {
    const root = fixture();
    stage(root, "added.json", synthetic);
    writeFileSync(path.join(root, "added.json"), "safe");
    const secret = runHook(root);
    expect(secret.status).toBe(1);
    expect(secret.stdout).toContain("@secretlint/secretlint-rule-gcp");
    expect(secret.stdout).not.toContain("\nlint\n");
    git(root, ["rm", "--force", "--", "added.json"]);
    stage(root, "private.sqlite", "synthetic");
    const privatePath = runHook(root);
    expect(privatePath.status).toBe(1);
    expect(privatePath.stderr).toContain("private.sqlite is a private path");
    git(root, ["rm", "--force", "--", "private.sqlite"]);
    const clean = runHook(root);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("lint");
  });
  it("rejects unknown scan modes with a clear error", () => {
    const result = scan(fixture(), "--missing");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });
});
