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

function gitValue(root: string, args: string[]) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.error === undefined && result.status === 0 ? result.stdout.trim() : null;
}

/** Retains the hook context for validation, but excludes it from publication checks. */
export function getPushCheckEnvironment(
  root: string,
): { ok: true; env: NodeJS.ProcessEnv } | { ok: false; reason: string } {
  const names = gitValue(root, ["rev-parse", "--local-env-vars"]);
  if (names === null || names === "")
    return { ok: false, reason: "Git command failed while checking repository environment." };
  const env = { ...process.env };
  for (const name of names.split("\n")) delete env[name];
  return { ok: true, env };
}

/** Checks the complete local checkout; ignored files do not affect publication. */
export function checkPushState(root: string): GitStateResult {
  const shallow = gitValue(root, ["rev-parse", "--is-shallow-repository"]);
  if (shallow === null) return { ok: false, reason: "Git command failed while checking history." };
  if (shallow !== "false") return { ok: false, reason: "Push checks refuse shallow repositories." };
  if (gitValue(root, ["rev-parse", "--verify", "HEAD"]) === null)
    return { ok: false, reason: "Push checks require a current HEAD." };
  const status = gitValue(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (status === null)
    return { ok: false, reason: "Git command failed while checking clean state." };
  if (status !== "")
    return {
      ok: false,
      reason:
        "Push checks require a clean index and working tree, including unignored untracked files.",
    };
  return { ok: true };
}

function parsePushRecord(
  root: string,
  line: string,
  oidPattern: RegExp,
  zero: string,
): { ok: true; localOid: string } | { ok: false; reason: string } {
  const fields = line.split(" ");
  const [localRef, localOid, remoteRef, remoteOid] = fields;
  if (
    fields.length !== 4 ||
    localRef === undefined ||
    localOid === undefined ||
    remoteRef === undefined ||
    remoteOid === undefined ||
    !oidPattern.test(localOid) ||
    !oidPattern.test(remoteOid)
  )
    return { ok: false, reason: "Invalid pre-push input record." };
  if (
    gitValue(root, ["check-ref-format", remoteRef]) === null ||
    (localOid === zero
      ? localRef !== "(delete)"
      : localRef !== "HEAD" &&
        !oidPattern.test(localRef) &&
        gitValue(root, ["check-ref-format", localRef]) === null)
  )
    return { ok: false, reason: "Invalid pre-push ref." };
  return { ok: true, localOid };
}

/** Parses all hook records before deciding whether checks can be skipped. */
export function validatePushInput(
  root: string,
  input: string,
): { ok: true; updates: boolean } | { ok: false; reason: string } {
  if (input === "") return { ok: true, updates: false };
  const format = gitValue(root, ["rev-parse", "--show-object-format"]);
  if (format !== "sha1" && format !== "sha256")
    return { ok: false, reason: "Git command failed while checking object format." };
  const length = format === "sha1" ? 40 : 64;
  const oidPattern = new RegExp(`^[0-9a-f]{${length}}$`);
  const zero = "0".repeat(length);
  const head = gitValue(root, ["rev-parse", "--verify", "HEAD"]);
  let updates = false;
  const lines = input.endsWith("\n") ? input.slice(0, -1).split("\n") : input.split("\n");
  for (const line of lines) {
    const record = parsePushRecord(root, line, oidPattern, zero);
    if (!record.ok) return record;
    const localOid = record.localOid;
    if (localOid !== zero) {
      if (localOid !== head)
        return {
          ok: false,
          reason: "Push checks require every updated tip to equal current HEAD.",
        };
      updates = true;
    }
  }
  return { ok: true, updates };
}
