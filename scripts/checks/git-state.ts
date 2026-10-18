import { spawnSync } from "node:child_process";

type GitStateResult = { ok: true } | { ok: false; reason: string };

/** Checks only; never stages, saves, or removes user files. */
export function checkCommitState(root: string): GitStateResult {
  const diff = spawnSync("/usr/bin/git", ["diff", "--quiet", "--ignore-submodules=none", "--"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (diff.error !== undefined || (diff.status !== 0 && diff.status !== 1)) {
    return { ok: false, reason: "Git command failed while checking unstaged changes." };
  }
  if (diff.status === 1) {
    return {
      ok: false,
      reason:
        "Commit checks require no unstaged tracked changes. Stage or save your changes, then retry.",
    };
  }
  const files = spawnSync(
    "/usr/bin/git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  );
  if (files.error !== undefined || files.status !== 0) {
    return { ok: false, reason: "Git command failed while checking untracked files." };
  }
  if (files.stdout.split("\0").some((file) => file !== "")) {
    return {
      ok: false,
      reason:
        "Commit checks require no unignored untracked files. Stage or save your files, then retry.",
    };
  }
  return { ok: true };
}
