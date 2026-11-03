import { copyFileSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
import { runSetupArguments } from "../../src/cli/setup.js";
import { executeMigration } from "../../src/cli/imports.js";
import { migrationApplication } from "../../src/bootstrap.js";
import { renderMigrationChoice } from "../../src/cli/migration-choice.js";
import { PromptCancelled } from "../../src/cli/prompts.js";
import { parseSetupArguments } from "../../src/cli/setup-parse.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  fixtures.splice(0).forEach((fixture) => fixture.cleanup());
});
async function setup(twoAccounts = false) {
  const fixture = temporaryDatabase();
  fixtures.push(fixture);
  await initializeDatabase(fixture.path);
  const register = join(fixture.directory, "register.csv"),
    plan = join(fixture.directory, "plan.csv"),
    review = join(fixture.directory, "review.json");
  copyFileSync(fileURLToPath(new URL("../fixtures/ynab/register.csv", import.meta.url)), register);
  copyFileSync(fileURLToPath(new URL("../fixtures/ynab/plan.csv", import.meta.url)), plan);
  if (twoAccounts) {
    const csv = readFileSync(register, "utf8");
    const firstNewline = csv.indexOf("\n");
    writeFileSync(
      register,
      csv + csv.slice(firstNewline + 1).replaceAll("Demo cash", "Demo savings"),
    );
  }
  const run = (args: string[]) =>
    runCli(["--db", fixture.path, "setup", "migrate", ...args, "--json"], fixture.directory);
  const preview = run(["preview", "--register", register, "--plan", plan, "--review", review]);
  expect(preview.status, preview.stderr).toBe(0);
  return { ...fixture, register, plan, review, run };
}
it("resumes private review across processes and rejects stale changes", async () => {
  const fixture = await setup();
  const changed = fixture.run([
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--name",
    "Demo cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "1",
  ]);
  expect(changed.status, changed.stderr).toBe(0);
  expect(JSON.parse(changed.stdout).revision).toBe(2);
  const resumed = fixture.run(["review", "--review", fixture.review]);
  expect(resumed.status, resumed.stderr).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({
    revision: 2,
    derived: { accounts: [{ name: "Demo cash" }] },
  });
  const stale = fixture.run([
    "acknowledge",
    "any",
    "--review",
    fixture.review,
    "--expected-review",
    "1",
  ]);
  expect(stale.status).toBe(4);
  expect(JSON.parse(stale.stderr).reason).toBe("stale-review");
});
it("offers guided review actions in a terminal and can stop without changes", async () => {
  const fixture = await setup();
  const ask = vi.fn(async () => "done");
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const value = await executeMigration(
    parseSetupArguments([
      "--db",
      fixture.path,
      "setup",
      "migrate",
      "review",
      "--review",
      fixture.review,
    ]),
    { interactive: true, ask },
  );
  expect(ask).toHaveBeenCalled();
  expect(value).toMatchObject({ revision: 1 });
});

function interactiveCommand(fixture: Awaited<ReturnType<typeof setup>>) {
  return parseSetupArguments([
    "--db",
    fixture.path,
    "setup",
    "migrate",
    "review",
    "--review",
    fixture.review,
  ]);
}
function scriptedAnswers(values: string[]) {
  const pending = [...values];
  return vi.fn(async (question: string) => {
    const answer = pending.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    if (answer === "cancel") throw new PromptCancelled();
    return answer;
  });
}
it("guides an account by name, lists choices, retries invalid values, and preserves it on cancellation", async () => {
  const fixture = await setup();
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["", "Demo cash", "wrong", "cash", "false", "", "yes", "cancel"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const questions = ask.mock.calls.map(([question]) => question).join("\n");
  expect(questions).toContain("cash, credit, [t]racking, [h]elp, [a]bandon");
  expect(questions).toContain(
    "Is this account closed? ([n]o (default), [y]es, [h]elp, [a]bandon): ",
  );
  expect(questions).not.toContain("Source account, group, row");
  expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
    "next up: account kind. Please pick between:",
  );
  expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
    "Account 1 of 1: Demo cash",
  );
  const resumed = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(resumed).toMatchObject({
    revision: 2,
    derived: { accounts: [{ name: "Demo cash", kind: "cash", closed: false }] },
  });
  expect(
    JSON.parse(
      runCli(["--db", fixture.path, "account", "list", "--json"], fixture.directory).stdout,
    ).accounts,
  ).toEqual([]);
});
it("walks multiple source accounts in order without asking for keys", async () => {
  const fixture = await setup(true);
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers([
    "continue",
    "Demo cash",
    "cash",
    "no",
    "yes",
    "Demo savings",
    "cash",
    "no",
    "yes",
    "cancel",
  ]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const rendered = output.mock.calls.map(([value]) => String(value)).join("");
  expect(rendered).toContain("Account 1 of 2: Demo cash");
  expect(rendered).toContain("Account 2 of 2: Demo savings");
  const view = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(view.derived.accounts).toHaveLength(2);
});
it("resumes saved mapping choices and asks for the missing opening with date and USD guidance", async () => {
  const fixture = await setup();
  fixture.run([
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--name",
    "Demo cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "1",
  ]);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["continue", "keep", "2026-10-22", "100.00", "yes", "cancel"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const questions = ask.mock.calls.map(([question]) => question).join("\n");
  expect(questions).toContain("YYYY-MM-DD");
  expect(questions).toContain("USD");
  const view = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(view.derived.accounts[0]).toMatchObject({
    openingDate: "2026-10-22",
    openingCents: 10000,
  });
});
it("saves a complete review without importing, then resumes and requires separate import confirmation", async () => {
  const fixture = await setup();
  const rendered = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers([
    "continue",
    "Demo cash",
    "cash",
    "no",
    "yes",
    "2026-10-22",
    "100.00",
    "yes",
    "history",
    "yes",
    "import",
    "no",
    "save",
  ]);
  const result = await executeMigration(interactiveCommand(fixture), { interactive: true, ask });
  expect(result).toMatchObject({ revision: 4, derived: { ready: true } });
  expect(
    JSON.parse(
      runCli(["--db", fixture.path, "setup", "status", "--json"], fixture.directory).stdout,
    ).state,
  ).toBe("open");
  expect(
    JSON.parse(
      runCli(["--db", fixture.path, "account", "list", "--json"], fixture.directory).stdout,
    ).accounts,
  ).toEqual([]);
  const transcript = rendered.mock.calls.map(([value]) => String(value)).join("");
  expect(transcript).toContain("Migration summary");
  expect(transcript).toContain("Opening date: 2026-10-22\nOpening balance: 100.00 USD");
  expect(transcript).toContain("Acknowledgement: unverified history coverage");
  const resumed = scriptedAnswers(["continue", "keep", "keep", "history", "import", "yes"]);
  const receipt = await executeMigration(interactiveCommand(fixture), {
    interactive: true,
    ask: resumed,
  });
  expect(receipt).toMatchObject({ reused: false, report: { sourceRows: 5, historyOnly: 5 } });
  expect(
    JSON.parse(
      runCli(["--db", fixture.path, "setup", "status", "--json"], fixture.directory).stdout,
    ).state,
  ).toBe("ynab");
});
it("does not save a partially answered account when the user cancels", async () => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["continue", "Unsaved account", "cash", "cancel"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const view = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(view.revision).toBe(1);
  expect(view.derived.accounts).toEqual([]);
});
it("lists allowed enum values and retries for explicit interactive account commands too", async () => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["Demo cash", "bad", "cash", "false", "no", "yes"]);
  const command = parseSetupArguments([
    "--db",
    fixture.path,
    "setup",
    "migrate",
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--expected-review",
    "1",
  ]);
  await expect(executeMigration(command, { interactive: true, ask })).resolves.toMatchObject({
    revision: 2,
  });
  expect(ask.mock.calls.map(([question]) => question).join("\n")).toContain(
    "cash, credit, [t]racking, [h]elp, [a]bandon",
  );
});
it("rejects a concurrent review change made while a guided choice is awaiting confirmation", async () => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const answers = ["continue", "Demo cash", "cash", "no", "yes"];
  const ask = vi.fn(async (question: string) => {
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    if (question.startsWith("--> Save this review choice?")) {
      const changed = fixture.run([
        "account",
        "account:1",
        "--review",
        fixture.review,
        "--expected-review",
        "1",
        "--name",
        "Concurrent choice",
        "--kind",
        "cash",
        "--closed",
        "no",
      ]);
      expect(changed.status, changed.stderr).toBe(0);
    }
    return answer;
  });
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toThrow("stale-review");
  const stored = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(stored.derived.accounts[0].name).toBe("Concurrent choice");
});

it("abandons the review from the first prompt without removing saved choices", async () => {
  const fixture = await setup();
  fixture.run([
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--name",
    "Saved cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "1",
  ]);
  const before = fixture.run(["review", "--review", fixture.review]).stdout;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await expect(
    executeMigration(interactiveCommand(fixture), {
      interactive: true,
      ask: scriptedAnswers(["a"]),
    }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  expect(fixture.run(["review", "--review", fixture.review]).stdout).toBe(before);
});

it("abandons at account kind without saving a partial account", async () => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["continue", "Unsaved name", "abandon"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const stored = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(stored.revision).toBe(1);
  expect(stored.derived.accounts).toEqual([]);
});

it("shows the complete proposed account before saving and accepts Enter as yes", async () => {
  const fixture = await setup();
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const next = scriptedAnswers(["continue", "Deeemo cash", "cash", "", "", "cancel"]);
  const ask = vi.fn(async (question: string) => {
    if (question.startsWith("--> Save this review choice?")) {
      expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
        "Account 1 of 1: Deeemo cash\nKind: cash\nClosed: no",
      );
      expect(question).toBe(
        "--> Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon): ",
      );
    }
    return next(question);
  });
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const stored = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(stored).toMatchObject({
    revision: 2,
    derived: { accounts: [{ name: "Deeemo cash", kind: "cash", closed: false }] },
  });
});
it.each(["n", "a"])("does not save the proposed account for confirmation %s", async (answer) => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["continue", "Unsaved cash", "cash", "no", answer, "save"]);
  const pending = executeMigration(interactiveCommand(fixture), { interactive: true, ask });
  if (answer === "a") await expect(pending).rejects.toBeInstanceOf(PromptCancelled);
  else await expect(pending).resolves.toMatchObject({ revision: 1 });
  const stored = JSON.parse(fixture.run(["review", "--review", fixture.review]).stdout);
  expect(stored).toMatchObject({ revision: 1, derived: { accounts: [] } });
});

it("previews all proposed row values instead of the saved row values", async () => {
  const fixture = await setup();
  fixture.run([
    "account",
    "account:1",
    "--review",
    fixture.review,
    "--name",
    "Demo cash",
    "--kind",
    "cash",
    "--closed",
    "no",
    "--expected-review",
    "1",
  ]);
  const view = migrationApplication(fixture.path).inspect(fixture.review);
  const row = view.derived.rows.at(0);
  if (!row) throw new Error("Missing synthetic row");
  const preview = renderMigrationChoice(view, {
    tag: "row",
    key: row.key,
    accountKey: row.accountKey,
    treatment: "posted",
    postedOn: "2026-10-23",
    role: "transaction",
    payee: "Corrected payee",
  });
  expect(preview).toContain("Account: Demo cash");
  expect(preview).toContain(`Source row: ${row.source.ordinal}`);
  expect(preview).toContain(
    "Date: 2026-10-22\nAmount: -12.34 USD\nPayee: Corrected payee\nTreatment: posted\nPosted on: 2026-10-23\nRole: transaction",
  );
});

it("opening-date help repeats the same default question without changing saved choices", async () => {
  const fixture = await setup();
  const app = migrationApplication(fixture.path);
  await app.change(fixture.review, 1, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Demo cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  const today = app.inspect(fixture.review).derived.asOfDate;
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const answers = ["continue", "keep", "h", "H", "help", "", "100.00", "y", "a"];
  const dateQuestions: string[] = [];
  let dateHelpStart = 0;
  const ask = vi.fn(async (question: string) => {
    if (question.startsWith("--> Posted closing balance date")) {
      dateQuestions.push(question);
      const saved = app.inspect(fixture.review);
      expect(saved.revision).toBe(2);
      expect(saved.derived.accounts[0]?.openingDate).toBeNull();
      if (dateQuestions.length > 1) {
        const help = output.mock.calls
          .slice(dateHelpStart)
          .map(([value]) => String(value))
          .join("")
          .toLowerCase();
        expect(help).toContain("closing balance");
        expect(help).toContain("today");
        expect(help).toContain("local");
      }
      dateHelpStart = output.mock.calls.length;
    }
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    return answer;
  });
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  expect(dateQuestions).toHaveLength(4);
  expect(new Set(dateQuestions).size).toBe(1);
  expect(dateQuestions[0]).toContain(today);
  expect(dateQuestions[0]).toContain("; or [h]elp, or [a]bandon):");
  expect(app.inspect(fixture.review)).toMatchObject({
    revision: 3,
    derived: { accounts: [{ openingDate: today, openingCents: 10000 }] },
  });
  expect(output.mock.calls.map(([value]) => String(value)).join("")).not.toContain("Credit debt");
});

it.each(["y", "Y"])(
  "save help requires a later explicit %s and abandonment keeps saved choices",
  async (confirmation) => {
    const fixture = await setup();
    const app = migrationApplication(fixture.path);
    const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const answers = ["C", "Helped cash", "cash", "N", "h", "H", "HeLp", confirmation, "A"];
    const saveQuestions: string[] = [];
    let saveHelpStart = 0;
    const ask = vi.fn(async (question: string) => {
      if (question.startsWith("--> Save this review choice?")) {
        saveQuestions.push(question);
        expect(app.inspect(fixture.review).revision).toBe(1);
        expect(app.inspect(fixture.review).derived.accounts).toEqual([]);
        if (saveQuestions.length > 1) {
          const help = output.mock.calls
            .slice(saveHelpStart)
            .map(([value]) => String(value))
            .join("")
            .toLowerCase();
          expect(help).toContain("review file");
          expect(help).toContain("database");
        }
        saveHelpStart = output.mock.calls.length;
      }
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
      return answer;
    });
    await expect(
      executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
    ).rejects.toBeInstanceOf(PromptCancelled);
    expect(saveQuestions).toHaveLength(4);
    expect(new Set(saveQuestions).size).toBe(1);
    expect(saveQuestions[0]).toContain("[h]elp");
    expect(app.inspect(fixture.review)).toMatchObject({
      revision: 2,
      derived: { accounts: [{ name: "Helped cash", closed: false }] },
    });
  },
);

it("accepts unique enum initials while ambiguous cash-credit initials repeat the question", async () => {
  const fixture = await setup();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["C", "Demo tracking", "c", "C", "T", "N", "Y", "a"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
  const questions = ask.mock.calls.map(([question]) => question);
  expect(questions.filter((question) => question.includes("Account kind"))).toHaveLength(3);
  expect(migrationApplication(fixture.path).inspect(fixture.review)).toMatchObject({
    revision: 2,
    derived: { accounts: [{ kind: "tracking", closed: false }] },
  });
});

it("shows starting review steps and progress before the separated history section", async () => {
  const fixture = await setup();
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const answers = scriptedAnswers([
    "continue",
    "Demo cash",
    "cash",
    "no",
    "yes",
    "2026-10-22",
    "100.00",
    "yes",
    "a",
  ]);
  const ask = vi.fn(async (question: string) => {
    const rendered = output.mock.calls.map(([value]) => String(value)).join("");
    if (question.includes("Start migration review"))
      expect(rendered).toContain("Required review steps: 3");
    if (question.includes("Action (")) {
      expect(rendered).toContain("2 of 3 steps addressed; 1 required step remains.");
      expect(rendered).toContain("\n\nHistory:\n");
      expect(rendered).toContain("\n\nHistory:\nAccount: Demo cash\n");
      expect(question.startsWith("--> ")).toBe(true);
    }
    return answers(question);
  });
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).rejects.toBeInstanceOf(PromptCancelled);
});
it("History save returns to the summary before another account's opening questions", async () => {
  const fixture = await setup(true);
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const answers = scriptedAnswers([
    "continue",
    "Demo cash",
    "cash",
    "no",
    "yes",
    "Demo savings",
    "cash",
    "no",
    "yes",
    "2026-10-22",
    "100.00",
    "yes",
    "s",
    "save",
  ]);
  const ask = vi.fn(async (question: string) => answers(question));
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).resolves.toMatchObject({ revision: 4 });
  const questions = ask.mock.calls.map(([question]) => question);
  expect(
    questions.filter((question) => question.includes("Posted closing balance date")),
  ).toHaveLength(1);
  expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
    "Migration summary:",
  );
  const stored = migrationApplication(fixture.path).inspect(fixture.review);
  expect(
    stored.derived.accounts.find((account) => account.name === "Demo savings")?.openingDate,
  ).toBeNull();
  expect(
    stored.derived.issues.some(
      (issue) => issue.reason === "unverified-history-coverage" && issue.blocking,
    ),
  ).toBe(true);
});

it("returns from observations through evidence to the summary without losing saved choices", async () => {
  const fixture = await setup();
  const app = migrationApplication(fixture.path);
  let view = app.inspect(fixture.review);
  view = await app.change(fixture.review, view.revision, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Saved cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(fixture.review, view.revision, {
    tag: "opening",
    accountKey: "account:1",
    date: "2026-10-22",
    cents: 10882,
  });
  view = await app.change(fixture.review, view.revision, { tag: "ack", key: "history:account:1" });
  const before = app.inspect(fixture.review);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers([
    "continue",
    "",
    "",
    "s",
    "review",
    "observations",
    "b",
    "b",
    "save",
  ]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).resolves.toMatchObject({ revision: view.revision });
  expect(app.inspect(fixture.review)).toEqual(before);
  const questions = ask.mock.calls.map(([question]) => question);
  expect(questions.find((question) => question.includes("Saved mapping"))).toContain(
    "[k]eep (default), [e]dit",
  );
  expect(questions.find((question) => question.includes("Saved opening"))).toContain(
    "[k]eep (default), [e]dit",
  );
  const observation = questions.findIndex((question) => question.includes("Tracking observations"));
  expect(observation).toBeGreaterThan(0);
  expect(questions[observation]).toContain("[b]ack");
  expect(questions[observation + 1]).toContain("Evidence review");
  expect(questions[observation + 2]).toContain("Review complete. Next");
});

it("opens evidence on Enter when the summary has required issues without saving a revision", async () => {
  const fixture = await setup();
  const app = migrationApplication(fixture.path);
  let view = app.inspect(fixture.review);
  view = await app.change(fixture.review, view.revision, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Saved cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(fixture.review, view.revision, {
    tag: "opening",
    accountKey: "account:1",
    date: "2026-10-22",
    cents: 10000,
  });
  const before = app.inspect(fixture.review);
  expect(before.derived.ready).toBe(false);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers(["continue", "", "", "save", "", "back", "save"]);
  await expect(
    executeMigration(interactiveCommand(fixture), { interactive: true, ask }),
  ).resolves.toMatchObject({ revision: view.revision });
  expect(app.inspect(fixture.review)).toEqual(before);
  const questions = ask.mock.calls.map(([question]) => question);
  const summaryIndex = questions.findIndex((question) =>
    question.includes("Review has required issues"),
  );
  expect(questions[summaryIndex]).toContain("[r]eview (default), [s]ave");
  expect(questions[summaryIndex + 1]).toContain("Evidence review");
  expect(questions.some((question) => question.includes("Confirm import"))).toBe(false);
});

it("explains an opening conflict and reports its removal after a confirmed history choice", async () => {
  const fixture = await setup();
  const app = migrationApplication(fixture.path);
  let view = app.inspect(fixture.review);
  view = await app.change(fixture.review, view.revision, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Demo cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(fixture.review, view.revision, {
    tag: "opening",
    accountKey: "account:1",
    date: "2026-10-29",
    cents: 10882,
  });
  const row = view.derived.rows.find((entry) => entry.source.value?.cents === -1234);
  if (!row) throw new Error("Missing fixture row");
  view = await app.change(fixture.review, view.revision, {
    tag: "row",
    key: row.key,
    accountKey: "account:1",
    treatment: "posted",
    postedOn: "2026-10-23",
    role: "transaction",
    payee: "Demo shop",
  });
  expect(
    view.derived.issues.filter((issue) => issue.reason === "posting-in-opening-period"),
  ).toHaveLength(2);
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = scriptedAnswers([
    "continue",
    "",
    "",
    "save",
    "",
    "warnings",
    "1",
    "history",
    "c",
    "yes",
    "back",
    "save",
  ]);
  await executeMigration(interactiveCommand(fixture), { interactive: true, ask });
  const transcript = output.mock.calls.map(([value]) => String(value)).join("");
  expect(transcript).toContain("posting date 2026-10-23");
  expect(transcript).toContain("opening balance date 2026-10-29");
  expect(transcript).toContain("Cleared blocker: Demo cash | Demo shop");
  const after = app.inspect(fixture.review);
  expect(after.revision).toBe(view.revision + 1);
  expect(after.derived.issues.some((issue) => issue.reason === "posting-in-opening-period")).toBe(
    false,
  );
  expect(after.derived.rows.find((entry) => entry.key === row.key)?.treatment).toBe("history");
});

it("explains the normal migration path before the first review question", async () => {
  const fixture = await setup();
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = vi.fn(async () => {
    const text = output.mock.calls.map(([value]) => String(value)).join("");
    expect(text).toContain("1. Keep YNAB transactions as history");
    expect(text).toContain("2. Set starting balances");
    expect(text).toContain("3. Start using INAB");
    expect(text).toContain("do not change active balances");
    expect(text).toContain("bank's posted closing balance");
    expect(text).toContain("Pending activity does not change the posted balance");
    expect(text).toContain("Tracking accounts use reviewed balance observations and adjustments");
    expect(text).toContain("Moving imported rows into the active register is optional");
    return "done";
  });
  const before = migrationApplication(fixture.path).inspect(fixture.review);
  await executeMigration(interactiveCommand(fixture), { interactive: true, ask });
  expect(migrationApplication(fixture.path).inspect(fixture.review)).toEqual(before);
});

async function completedFixture() {
  const fixture = await setup();
  const app = migrationApplication(fixture.path);
  let view = app.inspect(fixture.review);
  view = await app.change(fixture.review, view.revision, {
    tag: "account",
    sourceAccount: "account:1",
    name: "Demo cash",
    kind: "cash",
    closed: false,
    newGroup: false,
  });
  view = await app.change(fixture.review, view.revision, {
    tag: "opening",
    accountKey: "account:1",
    date: "2026-10-22",
    cents: 10000,
  });
  view = await app.change(fixture.review, view.revision, { tag: "ack", key: "history:account:1" });
  await app.commit(fixture.review, view.revision);
  return fixture;
}

it("reports Migration completed without prompts or writes when reopening an imported review", async () => {
  const fixture = await completedFixture();
  const beforeDatabase = readFileSync(fixture.path);
  const beforeReview = readFileSync(fixture.review);
  rmSync(fixture.register);
  rmSync(fixture.plan);
  const ask = vi.fn(async () => {
    throw new Error("unexpected-prompt");
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await runSetupArguments(
    ["--db", fixture.path, "setup", "migrate", "review", "--review", fixture.review, "-i"],
    { interactive: true, ask },
  );
  expect(process.exitCode ?? 0).toBe(0);
  expect(stdout).toHaveBeenCalledExactlyOnceWith("Migration completed\n");
  expect(stderr).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
  expect(readFileSync(fixture.path)).toEqual(beforeDatabase);
  expect(readFileSync(fixture.review)).toEqual(beforeReview);
});

it("does not mistake a replaced imported database for a completed matching review", async () => {
  const fixture = await completedFixture();
  const replacement = join(fixture.directory, "replacement.sqlite");
  copyFileSync(fixture.path, replacement);
  renameSync(replacement, fixture.path);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = vi.fn(async () => {
    throw new Error("unexpected-prompt");
  });
  await runSetupArguments(
    ["--db", fixture.path, "setup", "migrate", "review", "--review", fixture.review, "-i"],
    { interactive: true, ask },
  );
  expect(process.exitCode).toBe(4);
  expect(stderr).toHaveBeenCalledWith("stale-target\n");
  expect(stdout).not.toHaveBeenCalled();
  expect(ask).not.toHaveBeenCalled();
});
