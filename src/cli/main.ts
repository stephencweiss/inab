const help = `INAB — manual accounts

Usage: inab --help

Only help is available. These manual-account commands are planned and not available yet:
  inab --db PATH init
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
} else {
  process.stderr.write("Invalid or unavailable command. Use --help for command status.\n");
  process.exitCode = 2;
}
