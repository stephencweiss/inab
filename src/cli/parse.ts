export type TerminalCommand = {
  database: string;
  action: "init" | "add" | "list" | "show" | "rename" | "opening";
  id: string | null;
  json: boolean;
  confirm: boolean;
  name: string | null;
  kind: string | null;
  currency: string;
  opening: string | null;
  date: string | null;
  expectedVersion: number | null;
};
const valueFlags = new Set([
  "--db",
  "--name",
  "--kind",
  "--currency",
  "--opening",
  "--amount",
  "--as-of",
  "--expected-version",
]);
const flagsFor = {
  init: ["--db", "--confirm", "--json"],
  add: ["--db", "--name", "--kind", "--currency", "--opening", "--as-of", "--confirm", "--json"],
  list: ["--db", "--json"],
  show: ["--db", "--json"],
  rename: ["--db", "--name", "--expected-version", "--confirm", "--json"],
  opening: ["--db", "--amount", "--as-of", "--expected-version", "--confirm", "--json"],
};
function parseTokens(args: string[]) {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token) throw new Error("Invalid empty argument");
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    if (flags.has(token)) throw new Error(`Duplicate flag: ${token}`);
    if (token === "--confirm" || token === "--json") flags.set(token, "true");
    else if (valueFlags.has(token)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value: ${token}`);
      flags.set(token, value);
    } else throw new Error(`Unknown flag: ${token}`);
  }
  return { flags, positionals };
}
function parseAction(words: string[]): Pick<TerminalCommand, "action" | "id"> {
  if (words[0] === "init" && words.length === 1) return { action: "init" as const, id: null };
  if (words[0] !== "account")
    throw new Error("Invalid or unavailable command. Use --help for command status.");
  const action = words[1];
  if (action === "add" || action === "list") {
    if (words.length !== 2) throw new Error("Invalid arguments");
    return { action, id: null };
  }
  if (action === "show" || action === "rename" || action === "opening") {
    if (words.length > 3) throw new Error("Invalid arguments");
    return { action, id: words[2] ?? null };
  }
  throw new Error("Invalid or unavailable command. Use --help for command status.");
}
export function parseArguments(args: string[]): TerminalCommand {
  const { flags, positionals } = parseTokens(args);
  const parsed = parseAction(positionals);
  const allowed = flagsFor[parsed.action];
  for (const flag of flags.keys())
    if (!allowed.includes(flag)) throw new Error(`Flag not valid for ${parsed.action}: ${flag}`);
  const database = flags.get("--db");
  if (!database?.trim()) throw new Error("An explicit --db path is required");
  const rawRevision = flags.get("--expected-version");
  const expectedVersion = rawRevision === undefined ? null : Number(rawRevision);
  if (
    expectedVersion !== null &&
    (!/^\d+$/.test(rawRevision ?? "") ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1)
  )
    throw new Error("Invalid expected version");
  return {
    database,
    ...parsed,
    json: flags.has("--json"),
    confirm: flags.has("--confirm"),
    name: flags.get("--name") ?? null,
    kind: flags.get("--kind") ?? null,
    currency: flags.get("--currency") ?? "USD",
    opening: flags.get(parsed.action === "opening" ? "--amount" : "--opening") ?? null,
    date: flags.get("--as-of") ?? null,
    expectedVersion,
  };
}
