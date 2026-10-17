import { spawnSync } from "node:child_process";
import { runChecks } from "./checks/runner.ts";

const npmPath = process.env.npm_execpath;
if (npmPath === undefined) throw new Error("Run the checks with npm run check.");
const status = runChecks((name) => {
  const result = spawnSync(process.execPath, [npmPath, "run", name], { stdio: "inherit" });
  if (result.error !== undefined) console.error(result.error.message);
  return result.status ?? 1;
});
process.exit(status);
