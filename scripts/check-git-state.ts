import { checkCommitState } from "./checks/git-state.ts";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "commit") {
  console.error("Usage: check-git-state commit");
  process.exit(2);
}
const result = checkCommitState(process.cwd());
if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}
