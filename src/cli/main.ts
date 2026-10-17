import { initializeDatabase } from "../bootstrap.js";
const help = `INAB — manual accounts

Usage: inab --help

Available: inab --db PATH init --confirm [--json]

These manual-account commands are planned and not available yet:
  inab --db PATH account add|list|show|rename|opening
  inab --db PATH transaction add|edit|clear|unclear
  inab --db PATH register ID
  inab --db PATH reconcile ID
  inab --db PATH reconciliation list
  inab --db PATH snapshot add|correct|list
  inab --db PATH backup --to NEW_PATH
  inab restore --from BACKUP_PATH --to NEW_PATH
`;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(help);
} else if (
  args[0] === "--db" &&
  args[1]?.trim() &&
  args[2] === "init" &&
  args.slice(3).includes("--confirm") &&
  args.slice(3).every((arg) => arg === "--confirm" || arg === "--json") &&
  new Set(args.slice(3)).size === args.slice(3).length
) {
  const target = args[1];
  if (!args.includes("--json")) process.stderr.write(`Init target: ${target}\n`);
  try {
    const result = await initializeDatabase(target);
    process.stdout.write(
      args.includes("--json")
        ? `${JSON.stringify(result)}\n`
        : `Initialized database: ${result.database}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Storage failure"}\n`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write("Invalid or unavailable command. Use --help for command status.\n");
  process.exitCode = 2;
}
