import { blockedCandidateFiles } from "./checks/tracked-paths.ts";

const blocked = blockedCandidateFiles(process.cwd());
for (const file of blocked) {
  console.error(`${file} is a private path and cannot be committed.`);
}
if (blocked.length > 0) process.exit(1);
