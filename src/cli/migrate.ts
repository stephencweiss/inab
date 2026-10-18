import { upgradeDatabase } from "../bootstrap.js";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--db" || !args[1]?.trim()) {
  process.stderr.write("Usage: db:migrate --db PATH\n");
  process.exitCode = 2;
} else {
  process.stderr.write(`Migration target: ${args[1]}\n`);
  try {
    process.stdout.write(`${JSON.stringify(await upgradeDatabase(args[1]))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Storage failure"}\n`);
    process.exitCode = 1;
  }
}
