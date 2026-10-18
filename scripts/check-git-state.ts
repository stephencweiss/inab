import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkCommitState, checkPushState, validatePushInput } from "./checks/git-state.ts";

const args = process.argv.slice(2);
const mode = args[0];
if (args.length !== 1 || !["commit", "push-clean", "push-hook"].includes(mode ?? "")) {
  console.error("Usage: check-git-state commit|push-clean|push-hook");
  process.exit(2);
}
if (mode === "push-hook") {
  const input = validatePushInput(process.cwd(), readFileSync(0, "utf8"));
  if (!input.ok) {
    console.error(input.reason);
    process.exit(1);
  }
  if (!input.updates) process.exit(0);
}
const result = mode === "commit" ? checkCommitState(process.cwd()) : checkPushState(process.cwd());
if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}
if (mode === "push-hook") {
  const child = spawnSync(path.join(path.dirname(process.execPath), "npm"), ["run", "check:push"], {
    cwd: process.cwd(),
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 600_000,
  });
  if (child.error !== undefined || child.signal !== null) {
    console.error("Push checks could not complete.");
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}
