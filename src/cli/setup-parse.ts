export type SetupAction =
  | "menu"
  | "status"
  | "fresh"
  | "preview"
  | "review"
  | "account"
  | "opening"
  | "row"
  | "observation"
  | "resolve"
  | "acknowledge"
  | "commit"
  | "history-accounts"
  | "history-register"
  | "history-plan"
  | "history-report";
export type SetupCommand = {
  action: SetupAction;
  selector: string | null;
  database: string;
  json: boolean;
  interactive: boolean;
  confirm: boolean;
  flags: Map<string, string>;
};
const switches = new Set(["--json", "--confirm", "--new-group", "--interactive"]);
const values = new Set([
  "--db",
  "--register",
  "--plan",
  "--review",
  "--name",
  "--kind",
  "--closed",
  "--expected-review",
  "--as-of",
  "--balance",
  "--account",
  "--treatment",
  "--posted-on",
  "--payee",
  "--role",
  "--row",
  "--choice",
  "--month",
  "--limit",
  "--offset",
]);
const shared = ["--db", "--json"];
const review = ["--review"];
const change = [...review, "--expected-review"];
const allowed: Record<SetupAction, string[]> = {
  menu: [],
  status: [],
  fresh: ["--confirm"],
  preview: [...review, "--register", "--plan"],
  review: [...review, "--interactive"],
  account: [...change, "--name", "--kind", "--closed", "--new-group"],
  opening: [...change, "--as-of", "--balance"],
  row: [...change, "--account", "--treatment", "--posted-on", "--payee", "--role"],
  observation: [...change, "--row", "--as-of", "--balance"],
  resolve: [...change, "--choice"],
  acknowledge: change,
  commit: [...change, "--confirm"],
  "history-accounts": [],
  "history-register": ["--limit", "--offset"],
  "history-plan": ["--month", "--limit", "--offset"],
  "history-report": [],
};
function tokens(args: string[]) {
  const flags = new Map<string, string>();
  const words: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const token = args[index] === "-i" ? "--interactive" : args[index];
    if (!token) throw new Error("invalid-argument");
    if (!token.startsWith("--")) {
      words.push(token);
      continue;
    }
    if (flags.has(token)) throw new Error("duplicate-flag");
    if (switches.has(token)) {
      flags.set(token, "true");
      continue;
    }
    if (!values.has(token)) throw new Error("unknown-flag");
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) throw new Error("missing-flag-value");
    flags.set(token, value);
  }
  return { flags, words };
}
export function isSetupArguments(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const token = args[index] === "-i" ? "--interactive" : (args[index] ?? "");
    if (switches.has(token)) continue;
    if (token.startsWith("--")) {
      index++;
      continue;
    }
    return token === "setup" || token === "import";
  }
  return false;
}
const routes: { command: string; action: SetupAction; selector: boolean }[] = [
  { command: "setup", action: "menu", selector: false },
  { command: "setup status", action: "status", selector: false },
  { command: "setup fresh", action: "fresh", selector: false },
  ...[
    "preview",
    "review",
    "account",
    "opening",
    "row",
    "observation",
    "resolve",
    "acknowledge",
    "commit",
  ].map((action) => parseMigrationRoute(action)),
  { command: "import history accounts", action: "history-accounts", selector: false },
  { command: "import history register", action: "history-register", selector: true },
  { command: "import history plan", action: "history-plan", selector: false },
  { command: "import history report", action: "history-report", selector: true },
];
function parseMigrationRoute(action: string): {
  command: string;
  action: SetupAction;
  selector: boolean;
} {
  switch (action) {
    case "preview":
    case "review":
    case "commit":
      return { command: `setup migrate ${action}`, action, selector: false };
    case "account":
    case "opening":
    case "row":
    case "observation":
    case "resolve":
    case "acknowledge":
      return { command: `setup migrate ${action}`, action, selector: true };
    default:
      throw new Error("invalid-command");
  }
}
function actionFor(words: string[]): { action: SetupAction; selector: string | null } {
  for (const route of routes) {
    const expected = route.command.split(" ");
    if (words.length !== expected.length + Number(route.selector)) continue;
    if (expected.every((word, index) => words[index] === word))
      return { action: route.action, selector: route.selector ? (words.at(-1) ?? null) : null };
  }
  throw new Error("invalid-command");
}
export function requireSetupFlag(command: SetupCommand, name: string) {
  const value = command.flags.get(name);
  if (value === undefined || !value.trim()) throw new Error(`required-${name.slice(2)}`);
  return value;
}
export function parseSetupInteger(text: string, minimum: number) {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < minimum)
    throw new Error("invalid-revision-or-page");
  return Number(text);
}
export function parseSetupArguments(args: string[]): SetupCommand {
  const { flags, words } = tokens(args);
  const parsed = actionFor(words);
  if (flags.has("--interactive") && flags.has("--json"))
    throw new Error("interactive-json-conflict");
  for (const flag of flags.keys())
    if (![...shared, ...allowed[parsed.action]].includes(flag))
      throw new Error("invalid-command-flag");
  const database = flags.get("--db");
  if (!database?.trim()) throw new Error("explicit-db-required");
  const revision = flags.get("--expected-review");
  if (revision !== undefined) parseSetupInteger(revision, 1);
  return {
    ...parsed,
    database,
    json: flags.has("--json"),
    interactive: flags.has("--interactive"),
    confirm: flags.has("--confirm"),
    flags,
  };
}
