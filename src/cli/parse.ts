function parseTransactionAction(words: string[]): Pick<TerminalCommand, "action" | "id"> {
  const action = words[1];
  if (action === "add" && words.length === 2) return { action: "transaction-add", id: null };
  if (words.length <= 3) {
    if (action === "edit") return { action: "transaction-edit", id: words[2] ?? null };
    if (action === "clear") return { action: "transaction-clear", id: words[2] ?? null };
    if (action === "unclear") return { action: "transaction-unclear", id: words[2] ?? null };
  }
  throw new Error("Invalid transaction arguments");
}
export type TerminalCommand = {
  database: string;
  action:
    | "init"
    | "add"
    | "list"
    | "show"
    | "rename"
    | "opening"
    | "transaction-add"
    | "transaction-edit"
    | "transaction-clear"
    | "transaction-unclear"
    | "register";
  accountId: string | null;
  payee: string | null;
  memo: string | null;
  postedOn: string | null;
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
  "--account",
  "--date",
  "--payee",
  "--memo",
  "--posted-on",
  "--name",
  "--kind",
  "--currency",
  "--opening",
  "--amount",
  "--as-of",
  "--expected-version",
]);
const flagsFor = {
  "transaction-add": [
    "--db",
    "--account",
    "--date",
    "--amount",
    "--payee",
    "--memo",
    "--posted-on",
    "--confirm",
    "--json",
  ],
  "transaction-edit": [
    "--db",
    "--date",
    "--amount",
    "--payee",
    "--memo",
    "--expected-version",
    "--confirm",
    "--json",
  ],
  "transaction-clear": ["--db", "--posted-on", "--expected-version", "--confirm", "--json"],
  "transaction-unclear": ["--db", "--expected-version", "--confirm", "--json"],
  register: ["--db", "--json"],
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
  if (words[0] === "register" && words.length <= 2)
    return { action: "register", id: words[1] ?? null };
  if (words[0] === "transaction") return parseTransactionAction(words);
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
  const expectedVersion = parseRevision(flags.get("--expected-version") ?? null);
  return {
    database,
    accountId: flags.get("--account") ?? null,
    payee: flags.get("--payee") ?? null,
    memo: flags.get("--memo") ?? null,
    postedOn: flags.get("--posted-on") ?? null,
    ...parsed,
    json: flags.has("--json"),
    confirm: flags.has("--confirm"),
    name: flags.get("--name") ?? null,
    kind: flags.get("--kind") ?? null,
    currency: flags.get("--currency") ?? "USD",
    opening:
      flags.get(
        parsed.action === "opening" || parsed.action.startsWith("transaction-")
          ? "--amount"
          : "--opening",
      ) ?? null,
    date: flags.get(parsed.action.startsWith("transaction-") ? "--date" : "--as-of") ?? null,
    expectedVersion,
  };
}

function parseRevision(raw: string | null) {
  const rawRevision = raw;
  const expectedVersion = rawRevision === null ? null : Number(rawRevision);
  if (
    expectedVersion !== null &&
    (!/^\d+$/.test(rawRevision ?? "") ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1)
  )
    throw new Error("Invalid expected version");
  return expectedVersion;
}
