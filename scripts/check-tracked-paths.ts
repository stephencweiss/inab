import { blockedCandidateFiles, type FileSelection } from "./checks/tracked-paths.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--staged" && args[0] !== "--tracked")) {
  console.error("Usage: check-tracked-paths [--staged|--tracked]");
  process.exit(2);
}
let selection: FileSelection = "candidates";
if (args[0] === "--staged") selection = "staged";
if (args[0] === "--tracked") selection = "tracked";
const blocked = blockedCandidateFiles(process.cwd(), selection);
for (const file of blocked) {
  console.error(`${file} is a private path and cannot be committed.`);
}
if (blocked.length > 0) process.exit(1);
