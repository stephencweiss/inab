import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tsxLoader = import.meta.resolve("tsx");
const entryPoint = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));

export function runCli(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, ["--import", tsxLoader, entryPoint, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
