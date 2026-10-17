import { checkDocuments } from "./checks/documents.ts";

const problems = checkDocuments(process.cwd());
for (const problem of problems) {
  console.error(`${problem.file}: ${problem.message}`);
}
if (problems.length > 0) process.exit(1);
