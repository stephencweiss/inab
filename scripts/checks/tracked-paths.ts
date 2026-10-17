import { execFileSync } from "node:child_process";

const PRIVATE_DIRECTORIES = [
  ["ynab-export", "export"],
  ["data", "household data"],
  ["backups", "backup"],
  ["private", "private data"],
  ["browser-profiles", "browser profile"],
] as const;

export function blockedTrackedPath(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "tests/fixtures" || normalized.startsWith("tests/fixtures/")) return null;
  const environment = environmentReason(normalized);
  if (environment !== null) return environment;
  for (const [directory, reason] of PRIVATE_DIRECTORIES) {
    if (normalized === directory || normalized.startsWith(`${directory}/`)) return reason;
  }
  if (isDatabaseFile(normalized)) return "database";
  return null;
}

/**
 * Git is called by its fixed path. A PATH lookup can run a different program.
 */
export function listCandidateFiles(root: string): readonly string[] {
  const output = execFileSync(
    "/usr/bin/git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "buffer",
    },
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter((file) => file !== "");
}

export type FileSelection = "candidates" | "tracked" | "staged";

export function listSelectedFiles(root: string, selection: FileSelection): readonly string[] {
  if (selection === "candidates") return listCandidateFiles(root);
  const args =
    selection === "staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=d", "-z", "--"]
      : ["ls-files", "--cached", "-z", "--"];
  return execFileSync("/usr/bin/git", args, { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "");
}

export function blockedCandidateFiles(
  root: string,
  selection: FileSelection = "candidates",
): readonly string[] {
  return listSelectedFiles(root, selection).filter((file) => blockedTrackedPath(file) !== null);
}

function environmentReason(filePath: string): string | null {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  if (name === ".env.example") return null;
  if (name === ".env" || name.startsWith(".env.")) return "environment file";
  return null;
}

function isDatabaseFile(filePath: string): boolean {
  return /(?:^|\/)[^/]+\.(?:sqlite3?|db)(?:$|-)/.test(filePath);
}
