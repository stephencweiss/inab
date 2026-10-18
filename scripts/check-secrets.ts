import { scanSecrets, type SecretSelection } from "./checks/secrets.ts";

const args = process.argv.slice(2);
const modes = new Map<string, SecretSelection>([
  ["--staged", "staged"],
  ["--tracked", "tracked"],
  ["--history", "history"],
]);
const selection = args.length === 0 ? "candidates" : modes.get(args[0] ?? "");
if (args.length > 1 || selection === undefined) {
  console.error("Usage: check-secrets [--staged|--tracked|--history]");
  process.exit(2);
}
try {
  process.exitCode = await scanSecrets(process.cwd(), selection);
} catch {
  console.error(
    "Secret scan failed. Install pinned dependencies with npm ci and check Git and scanner configuration.",
  );
  process.exitCode = 1;
}
