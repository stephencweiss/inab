import { checkBoundaries } from "./checks/boundaries.ts";

const problems = checkBoundaries(process.cwd());
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
