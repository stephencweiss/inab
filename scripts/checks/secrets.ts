import { execFileSync } from "node:child_process";
import { closeSync, constants, lstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { listCandidateFiles, listSelectedFiles } from "./tracked-paths.ts";

export type SecretSelection = "candidates" | "tracked" | "staged" | "history";
type Source = { file: string; content: string };

function git(root: string, args: string[]): string {
  return execFileSync("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
function indexSources(root: string, selection: "tracked" | "staged"): Source[] {
  return listSelectedFiles(root, selection).map((file) => ({
    file,
    content: git(root, ["show", `:${file}`]),
  }));
}
function historySources(root: string): Source[] {
  const sources: Source[] = [];
  const seen = new Set<string>();
  const commits = git(root, ["rev-list", "--all"]).split("\n").filter(Boolean);
  for (const commit of commits) {
    const entries = git(root, ["ls-tree", "-r", "-z", commit]).split("\0").filter(Boolean);
    for (const entry of entries) {
      const tab = entry.indexOf("\t");
      const metadata = entry.slice(0, tab).split(" ");
      const object = metadata[2];
      const file = entry.slice(tab + 1);
      const key = `${object}:${file}`;
      if (metadata[1] !== "blob" || object === undefined || seen.has(key)) continue;
      seen.add(key);
      sources.push({ file: `${commit}/${file}`, content: git(root, ["cat-file", "blob", object]) });
    }
  }
  return sources;
}
function candidateSources(root: string): Source[] {
  const sources: Source[] = [];
  for (const file of listCandidateFiles(root)) {
    try {
      const segments = file.split("/");
      for (let index = 1; index < segments.length; index++) {
        if (lstatSync(path.join(root, ...segments.slice(0, index))).isSymbolicLink()) {
          throw new Error("Candidate directory is a symbolic link.");
        }
      }
      const descriptor = openSync(path.join(root, file), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        sources.push({ file, content: readFileSync(descriptor, "utf8") });
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return sources;
}

/** Scan actual index/history bytes without checking out files or following their symlinks. */
export async function scanSecrets(root: string, selection: SecretSelection): Promise<number> {
  const { runSecretLint } = await import("secretlint");
  const configFilePath = path.resolve(import.meta.dirname, "../../.secretlintrc.json");
  let sources: Source[];
  if (selection === "history") sources = historySources(root);
  else if (selection === "candidates") sources = candidateSources(root);
  else sources = indexSources(root, selection);
  let status = 0;
  /** Validate the scanner and its preset even when the Git selection is empty. */
  if (sources.length === 0) sources.push({ file: "empty-selection.txt", content: "" });
  for (const source of sources) {
    const result = await runSecretLint({
      cliOptions: { cwd: root, stdinContent: source.content, stdinFileName: source.file },
      engineOptions: { formatter: "stylish", maskSecrets: true, configFilePath },
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr !== null) throw result.stderr;
    if (result.exitStatus !== 0) status = result.exitStatus;
  }
  return status;
}
