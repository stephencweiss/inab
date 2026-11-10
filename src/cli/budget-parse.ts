export type BudgetTerminalCommand = {
  action: string;
  selector: string | null;
  database: string;
  json: boolean;
  confirm: boolean;
  interactive: boolean;
  flags: Map<string, string>;
  lines: string[];
};
const switches = new Set([
  "--json",
  "--confirm",
  "--interactive",
  "--income",
  "--unallocated",
  "--amend",
]);
const shared = ["--db", "--json"];
const write = ["--expected-version", "--confirm"];
const draft = ["--review"];
const routes: Record<string, string[]> = {
  status: [],
  show: ["--month"],
  activity: ["--month", "--unallocated"],
  "activation start": [...draft, "--month", "--amend"],
  "activation review": [...draft, "--interactive"],
  "activation preview": draft,
  "activation set": [...draft, "--decision", "--expected-review", "--expected-version"],
  "activation commit": [...draft, ...write, "--expected-review"],
  "opening amend": [...draft, "--month"],
  "category add": [...write, "--group", "--name", "--id"],
  "category rename": [...write, "--name", "--group"],
  "category archive": write,
  "category unarchive": write,
  "category reorder": [...write, "--position", "--group"],
  assign: [...write, "--month", "--category", "--amount"],
  move: [...write, "--month", "--from", "--to", "--amount"],
  allocate: [
    ...write,
    "--category",
    "--line",
    "--income",
    "--unallocated",
    "--expected-transaction-version",
  ],
  "activity correct": [...write, "--decision", "--expected-activity-version"],
  "transfer add": [
    ...write,
    "--from",
    "--to",
    "--date",
    "--amount",
    "--category",
    "--expected-from-version",
    "--expected-to-version",
  ],
  "transfer link": [
    ...write,
    "--from",
    "--to",
    "--date",
    "--amount",
    "--category",
    "--expected-from-version",
    "--expected-to-version",
    "--from-transaction",
    "--to-transaction",
  ],
  "transfer edit": [...write, "--date", "--amount", "--category", "--expected-activity-version"],
  "transfer unlink": [...write, "--expected-activity-version"],
};
const selectors = new Set([
  "category rename",
  "category archive",
  "category unarchive",
  "category reorder",
  "allocate",
  "activity correct",
  "transfer edit",
  "transfer unlink",
]);
export function isBudgetArguments(args: string[]) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i] ?? "";
    if (switches.has(t) || t === "-i") continue;
    if (t.startsWith("--")) {
      i++;
      continue;
    }
    return t === "budget";
  }
  return false;
}
function validateFlag(token: string, flags: Map<string, string>, values: Set<string>) {
  if (flags.has(token) && token !== "--line") throw new Error("duplicate-flag");
  if (!values.has(token) && !switches.has(token)) throw new Error("unknown-flag");
}
function tokens(args: string[]) {
  const flags = new Map<string, string>(),
    words: string[] = [],
    lines: string[] = [];
  const values = new Set(Object.values(routes).flat().concat(shared));
  for (let i = 0; i < args.length; i++) {
    const token = args[i] === "-i" ? "--interactive" : args[i];
    if (!token) throw new Error("invalid-argument");
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    validateFlag(token, flags, values);
    if (switches.has(token)) {
      flags.set(token, "true");
      continue;
    }
    const value = args[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("missing-flag-value");
    if (token === "--line") lines.push(value);
    flags.set(token, value);
  }
  return { flags, words, lines };
}
export function parseBudgetArguments(args: string[]): BudgetTerminalCommand {
  const { flags, words, lines } = tokens(args);
  if (words.shift() !== "budget") throw new Error("invalid-command");
  let action = words.join(" "),
    selector: string | null = null;
  if (!Object.hasOwn(routes, action)) {
    selector = words.pop() ?? null;
    action = words.join(" ");
    if (!selectors.has(action)) throw new Error("invalid-command");
  } else if (selectors.has(action)) throw new Error("required-selector");
  for (const flag of flags.keys())
    if (![...shared, ...(routes[action] ?? [])].includes(flag))
      throw new Error("invalid-command-flag");
  const database = flags.get("--db");
  if (!database?.trim()) throw new Error("explicit-db-required");
  if (flags.has("--json") && flags.has("--interactive"))
    throw new Error("interactive-json-conflict");
  return {
    action,
    selector,
    database,
    json: flags.has("--json"),
    confirm: flags.has("--confirm"),
    interactive: flags.has("--interactive"),
    flags,
    lines,
  };
}
export function budgetFlag(command: BudgetTerminalCommand, name: string) {
  const value = command.flags.get(name);
  if (!value?.trim()) throw new Error(`required-${name.slice(2)}`);
  return value;
}
export function budgetInteger(value: string, minimum = 0) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
    throw new Error("invalid-revision-or-position");
  return Number(value);
}
