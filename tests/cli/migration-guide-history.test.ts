import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());
import { deriveReview } from "../../src/accounts/imports/review.js";
import { buildImportReport } from "../../src/accounts/imports/report.js";
import { checkTrackingHistory } from "../../src/accounts/imports/observations.js";
import type { LoadedSources, ReviewDecision } from "../../src/accounts/imports/types.js";
import type { ReviewChange } from "../../src/application/import-ports.js";
import type { GuideSession } from "../../src/cli/migration-guide-types.js";
import { reviewEvidence, reviewHistory } from "../../src/cli/migration-guide-history.js";
import {
  visibleReviewIssues,
  reviewIssueDetails,
  reviewIssueChanges,
} from "../../src/cli/migration-issues.js";
import { PromptCancelled } from "../../src/cli/prompt-errors.js";

function fixture(answers: string[], kind: "cash" | "tracking" = "cash") {
  const questions: string[] = [];
  const output: string[] = [];
  const changes: ReviewChange[] = [];
  const decisions: ReviewDecision[] = [
    {
      tag: "account",
      key: "account:1",
      sourceAccount: "account:1",
      localId: "local",
      name: "Demo account",
      kind,
      closed: false,
    },
  ];
  const sources: LoadedSources = {
    register: {
      path: "/synthetic/register",
      sha256: "a",
      bytes: new Uint8Array(),
      rows: [
        {
          key: "row:secret",
          ordinal: 2,
          raw: "",
          original: {},
          error: null,
          value: {
            ordinal: 2,
            account: "Demo account",
            occurredOn: "2026-10-22",
            postedOn: null,
            payee: "Demo shop",
            memo: "",
            categoryGroupCategory: "",
            categoryGroup: "",
            category: "",
            flag: "",
            outflowCents: 1234,
            inflowCents: 0,
            cents: -1234,
            sourceStatus: "Cleared",
          },
        },
      ],
    },
    plan: { path: "/synthetic/plan", sha256: "b", bytes: new Uint8Array(), rows: [] },
  };
  const read = () => {
    const derived = deriveReview(sources, decisions, "2026-10-29");
    return {
      reviewId: "test",
      revision: 1,
      sourceAccounts: [{ key: "account:1", name: "Demo account" }],
      derived,
      report: buildImportReport(derived),
      observations: checkTrackingHistory(derived),
    };
  };
  const session: GuideSession = {
    read,
    say: (value) => output.push(value),
    prompts: {
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`No answer: ${question}`);
        return answer;
      },
    },
    save: async (change) => {
      changes.push(change);
      if (change.tag === "row" || change.tag === "ack" || change.tag === "resolve")
        decisions.push(change);
      if (change.tag === "observation") decisions.push({ ...change, key: "observation:test" });
    },
  };
  return { session, questions, output, changes, decisions, sources };
}

it("uses an explicit history choice to acknowledge only that account coverage", async () => {
  const f = fixture(["history"]);
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([{ tag: "ack", key: "history:account:1" }]);
  expect(f.output.join(" ")).toContain("history");
  expect(f.questions[0]).toBe("--> Action ([h]istory, [e]dit, [s]ave, [a]bandon, help): ");
});

it("selects a row by number and requires an explicit posting date", async () => {
  const f = fixture(["edit", "1", "posted", "2026-10-01", "2026-10-24", "", "save"]);
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([
    {
      tag: "row",
      key: "row:secret",
      accountKey: "account:1",
      treatment: "posted",
      postedOn: "2026-10-24",
      role: "transaction",
      payee: "Demo shop",
    },
  ]);
  expect(f.output.join(" ")).toContain("2026-10-22");
  expect(f.output.join(" ")).toContain("Demo shop");
  expect(f.output.join(" ")).toContain("-12.34");
  expect(f.questions.join(" ")).not.toContain("row:secret");
});

it("does not acknowledge warnings when saving to obtain external evidence", async () => {
  const f = fixture(["save"]);
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([]);
});

it("creates a Tracking observation only from selected posted adjustment evidence", async () => {
  const f = fixture(["observations", "add", "1", "1", "2026-10-24", "500.00", "save"], "tracking");
  f.decisions.push({
    tag: "row",
    key: "row:secret",
    accountKey: "account:1",
    treatment: "posted",
    postedOn: "2026-10-24",
    role: "adjustment",
    payee: "Demo shop",
  });
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([
    {
      tag: "observation",
      accountKey: "account:1",
      rowKey: "row:secret",
      date: "2026-10-24",
      cents: 50000,
    },
  ]);
});

it("returns after deferring a Tracking difference", async () => {
  const f = fixture(["observations", "1", "defer"], "tracking");
  f.decisions.push({
    tag: "observation",
    key: "observation:test",
    accountKey: "account:1",
    rowKey: "row:secret",
    date: "2026-10-24",
    cents: 50000,
  });
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([{ tag: "resolve", key: "observation:test", choice: "defer" }]);
});

it("does not acknowledge an invalid source blocker", async () => {
  const f = fixture(["warnings", "1"]);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.output.join(" ")).toContain("opening");
});

it("can keep an empty source payee for history without inventing evidence", async () => {
  const f = fixture(["edit", "1", "history", "keep", "save"]);
  const value = f.sources.register.rows[0]?.value;
  if (!value) throw new Error("Missing synthetic source");
  value.payee = "";
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([
    {
      tag: "row",
      key: "row:secret",
      accountKey: "account:1",
      treatment: "history",
      postedOn: null,
      role: "transaction",
      payee: "",
    },
  ]);
});

it("requires Tracking roles explicitly and preserves the selected account mapping", async () => {
  const f = fixture(["edit", "1", "posted", "2026-10-22", "opening", "", "save"], "tracking");
  await reviewHistory(f.session, "account:1");
  expect(f.changes[0]).toMatchObject({
    tag: "row",
    accountKey: "account:1",
    treatment: "posted",
    role: "opening",
    postedOn: "2026-10-22",
  });
});

it("does not revise a Tracking adjustment without opening and posting evidence", async () => {
  const f = fixture(["observations", "1", "revise-adjustment"], "tracking");
  f.decisions.push({
    tag: "observation",
    key: "observation:test",
    accountKey: "account:1",
    rowKey: "row:secret",
    date: "2026-10-24",
    cents: 50000,
  });
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.output.join(" ")).toContain("Missing opening or posting evidence");
});

it("shows the account name beside row warning details", async () => {
  const f = fixture(["warnings", "save", "save"]);
  f.decisions.push({
    tag: "row",
    key: "row:secret",
    accountKey: "account:1",
    treatment: "posted",
    postedOn: "2026-10-01",
    role: "transaction",
    payee: "Demo shop",
  });
  await reviewEvidence(f.session);
  expect(f.output.find((line) => line.includes("invalid posting date"))).toContain("Demo account");
});

it("shows invalid source evidence without inventing parsed values", async () => {
  const f = fixture(["warnings", "save", "save"]);
  const row = f.sources.register.rows[0];
  if (!row) throw new Error("Missing source row");
  row.value = null;
  row.error = "invalid-amount";
  row.original = {
    Account: "Demo broken",
    Date: "10/22/2026",
    Payee: "Unparsed shop",
    Outflow: "bad-money",
  };
  await reviewEvidence(f.session);
  const line = f.output.find((value) => value.includes("invalid amount"));
  expect(line).toContain("register row 2");
  expect(line).toContain("Unparsed shop");
  expect(line).toContain("bad-money");
  expect(line).not.toContain("+0.00");
});

it("shows monthly conflict evidence before acknowledgement", async () => {
  const f = fixture([]);
  const value = {
    ordinal: 2,
    month: "2026-10",
    categoryGroupCategory: "Daily / Food",
    categoryGroup: "Daily",
    category: "Food",
    assignedCents: 10000,
    activityCents: -1000,
    availableCents: 9000,
  };
  f.sources.plan.rows.push(
    { key: "plan:first", ordinal: 2, raw: "", original: {}, error: null, value },
    {
      key: "plan:second",
      ordinal: 3,
      raw: "",
      original: {},
      error: null,
      value: { ...value, ordinal: 3, assignedCents: 20000, availableCents: 19000 },
    },
  );
  const issue = f.session
    .read()
    .derived.issues.findIndex((candidate) => candidate.reason === "conflicting-monthly-values");
  const answers = ["warnings", String(issue + 1), "acknowledge", "save"];
  f.session.prompts.ask = async () => {
    const answer = answers.shift();
    if (answer === undefined) throw new Error("No answer");
    return answer;
  };
  await reviewEvidence(f.session);
  const output = f.output.join(" ");
  expect(output).toContain("2026-10");
  expect(output).toContain("Daily / Food");
  expect(output).toContain("+100.00 USD");
  expect(output).toContain("+200.00 USD");
  expect(f.changes).toEqual([{ tag: "ack", key: "plan-conflict:1" }]);
});

it("can correct a declined source mapping from the evidence accounts list", async () => {
  const f = fixture(["accounts", "1", "", "cash", "no", "save"]);
  f.decisions.length = 0;
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([
    {
      tag: "account",
      sourceAccount: "account:1",
      name: "Demo account",
      kind: "cash",
      closed: false,
      newGroup: false,
    },
  ]);
});

it("can leave future activity as history without an impossible posting-date loop", async () => {
  const f = fixture(["edit", "1", "posted", "history", "", "save"]);
  const row = f.sources.register.rows[0]?.value;
  if (!row) throw new Error("Missing source");
  row.occurredOn = "2026-11-01";
  await reviewHistory(f.session, "account:1");
  expect(f.changes[0]).toMatchObject({ tag: "row", treatment: "history", postedOn: null });
  expect(f.output.join(" ")).toContain("future");
});

it("assigns an unassigned source row explicitly to a compatible split group", async () => {
  const f = fixture(["rows", "1", "1", "history", "", "save"]);
  const mapping = f.decisions[0];
  if (!mapping || mapping.tag !== "account") throw new Error("Missing mapping");
  mapping.key = "group:secret";
  mapping.name = "Demo split";
  await reviewEvidence(f.session);
  expect(f.changes[0]).toMatchObject({
    tag: "row",
    key: "row:secret",
    accountKey: "group:secret",
    treatment: "history",
  });
  expect(f.output.join(" ")).toContain("Demo split");
  expect(f.questions.join(" ")).not.toContain("group:secret");
});

it("keeps a Cash history row role when editing its payee", async () => {
  const f = fixture(["edit", "1", "history", "Updated shop", "save"]);
  f.decisions.push({
    tag: "row",
    key: "row:secret",
    accountKey: "account:1",
    treatment: "history",
    postedOn: null,
    role: "opening",
    payee: "Demo shop",
  });
  await reviewHistory(f.session, "account:1");
  expect(f.changes[0]).toMatchObject({
    tag: "row",
    role: "opening",
    treatment: "history",
    payee: "Updated shop",
  });
});

it("shows exact cents for large valid source amounts", async () => {
  const f = fixture(["edit", "1", "history", "", "save"]);
  const row = f.sources.register.rows[0]?.value;
  if (!row) throw new Error("Missing source");
  row.cents = 9007199254740990;
  await reviewHistory(f.session, "account:1");
  expect(f.output.join(" ")).toContain("+90071992547409.90 USD");
});

it("full help repeats the History action and H selects history without an implicit write", async () => {
  const f = fixture(["help", "HELP", "HeLp", "H"]);
  const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const ask = f.session.prompts.ask;
  f.session.prompts.ask = async (question) => {
    expect(f.changes).toEqual([]);
    return ask(question);
  };
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([{ tag: "ack", key: "history:account:1" }]);
  expect(f.questions).toHaveLength(4);
  expect(new Set(f.questions).size).toBe(1);
  expect(f.questions[0]).toBe("--> Action ([h]istory, [e]dit, [s]ave, [a]bandon, help): ");
  const help = output.mock.calls
    .map(([value]) => String(value))
    .join("")
    .toLowerCase();
  expect(help).toContain("history");
  expect(help).toContain("balance");
});

it("shows a blank line and History heading before account context and action meanings", async () => {
  const f = fixture(["S"]);
  await reviewHistory(f.session, "account:1");
  expect(f.output[0]).toBe("\nHistory:");
  expect(f.output[1]).toContain("Demo account");
  expect(f.output).toContain(
    "history: keep the current row choices and acknowledge unverified history coverage; history-only rows stay outside active balances.",
  );
  expect(f.output).toContain("edit: select a source row and change its treatment/evidence.");
  expect(f.output).toContain(
    "save: leave this section for the summary without adding an acknowledgement; previously saved choices remain. No import occurs.",
  );
  expect(f.changes).toEqual([]);
});

it.each(["h", "H"])("History action %s acknowledges coverage explicitly", async (answer) => {
  const f = fixture([answer]);
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toEqual([{ tag: "ack", key: "history:account:1" }]);
});

it("History E selects a numbered row and S leaves without acknowledging coverage", async () => {
  const f = fixture(["E", "1", "history", "", "S"]);
  await reviewHistory(f.session, "account:1");
  expect(f.changes).toHaveLength(1);
  expect(f.changes[0]).toMatchObject({ tag: "row", treatment: "history" });
  expect(f.output).toContain("\nSource rows:");
  expect(f.output).toContain("\nSource row:");
});

it.each(["a", "A"])("History action %s abandons without changing saved choices", async (answer) => {
  const f = fixture([answer]);
  await expect(reviewHistory(f.session, "account:1")).rejects.toBeInstanceOf(PromptCancelled);
  expect(f.changes).toEqual([]);
});

it("adds section breaks before evidence and Tracking observation menus", async () => {
  const f = fixture(["observations", "save", "save"], "tracking");
  await reviewEvidence(f.session);
  expect(f.output[0]).toBe("\nEvidence review:");
  expect(f.output).toContain("\nTracking observations:");
});

it("backs from an empty observation list to evidence and then the summary", async () => {
  const f = fixture(["observations", "BACK", "B"], "tracking");
  f.decisions.push({ tag: "ack", key: "history:account:1" });
  const before = structuredClone(f.decisions);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.decisions).toEqual(before);
  expect(f.session.read().revision).toBe(1);
  expect(f.questions.filter((question) => question.includes("Evidence review"))).toHaveLength(2);
  expect(f.questions.join(" ")).toContain("[b]ack");
});

it("backs from an observation action to its observation list without saving a resolution", async () => {
  const f = fixture(["observations", "1", "back", "back", "back"], "tracking");
  f.decisions.push({
    tag: "observation",
    key: "observation:test",
    accountKey: "account:1",
    rowKey: "row:secret",
    date: "2026-10-24",
    cents: 50000,
  });
  const before = structuredClone(f.decisions);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.decisions).toEqual(before);
  expect(
    f.questions.filter((question) => question.includes("Tracking observations:")),
  ).toHaveLength(2);
});

it.each([true, false])(
  "backs from adjustment rows to account selection, including empty rows: %s",
  async (posted) => {
    const f = fixture(["observations", "add", "1", "back", "back", "back", "back"], "tracking");
    if (posted)
      f.decisions.push({
        tag: "row",
        key: "row:secret",
        accountKey: "account:1",
        treatment: "posted",
        postedOn: "2026-10-24",
        role: "adjustment",
        payee: "Demo shop",
      });
    const before = structuredClone(f.decisions);
    await reviewEvidence(f.session);
    expect(f.changes).toEqual([]);
    expect(f.decisions).toEqual(before);
    expect(
      f.questions.filter((question) => question.includes("Select Tracking account")),
    ).toHaveLength(2);
    expect(
      f.questions.some((question) => question.includes("Select posted adjustment evidence")),
    ).toBe(true);
    expect(
      f.questions.filter((question) => question.includes("Tracking observations:")),
    ).toHaveLength(2);
  },
);

it("backs from row treatment to row selection and then evidence without a partial proposal", async () => {
  const f = fixture(["rows", "1", "back", "back", "back"]);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Select source row"))).toHaveLength(2);
  expect(f.questions.some((question) => question.includes("Payee"))).toBe(false);
});

it("backs from source rows to History without adding a coverage acknowledgement", async () => {
  const f = fixture(["edit", "back", "save"]);
  await expect(reviewHistory(f.session, "account:1")).resolves.toBe("summary");
  expect(f.changes).toEqual([]);
  expect(f.output.filter((line) => line === "\nHistory:")).toHaveLength(2);
});

it("backs from account actions to the account list and then evidence", async () => {
  const f = fixture(["accounts", "1", "back", "back", "back"]);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(
    f.questions.filter((question) => question.includes("Select account to correct")),
  ).toHaveLength(2);
});

it("backs from warnings to evidence without changing the review", async () => {
  const f = fixture(["warnings", "back", "back"]);
  const before = structuredClone(f.decisions);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.decisions).toEqual(before);
  expect(f.questions.filter((question) => question.includes("Evidence review"))).toHaveLength(2);
});

it("backs from monthly conflict actions to warnings without acknowledgement", async () => {
  const f = fixture([]);
  const value = {
    ordinal: 2,
    month: "2026-10",
    categoryGroupCategory: "Daily / Food",
    categoryGroup: "Daily",
    category: "Food",
    assignedCents: 10000,
    activityCents: -1000,
    availableCents: 9000,
  };
  f.sources.plan.rows.push(
    { key: "plan:first", ordinal: 2, raw: "", original: {}, error: null, value },
    {
      key: "plan:second",
      ordinal: 3,
      raw: "",
      original: {},
      error: null,
      value: { ...value, ordinal: 3, assignedCents: 20000 },
    },
  );
  const index = f.session
    .read()
    .derived.issues.findIndex((issue) => issue.reason === "conflicting-monthly-values");
  const answers = ["warnings", String(index + 1), "back", "back", "back"];
  f.session.prompts.ask = async (question) => {
    f.questions.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    return answer;
  };
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(
    f.questions.filter((question) => question.includes("Select warning or blocker")),
  ).toHaveLength(2);
});

it("abandons nested observation review while preserving confirmed choices", async () => {
  const f = fixture(["observations", "A"], "tracking");
  f.decisions.push({ tag: "ack", key: "history:account:1" });
  const before = structuredClone(f.decisions);
  await expect(reviewEvidence(f.session)).rejects.toBeInstanceOf(PromptCancelled);
  expect(f.changes).toEqual([]);
  expect(f.decisions).toEqual(before);
});

it("backs from Tracking role to treatment and discards the unfinished posting proposal", async () => {
  const f = fixture(
    ["rows", "1", "posted", "2026-10-24", "back", "back", "back", "back"],
    "tracking",
  );
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Row treatment"))).toHaveLength(2);
});

it("backs from the empty-payee menu without turning back into payee data", async () => {
  const f = fixture(["rows", "1", "history", "back", "back", "back", "back"]);
  const row = f.sources.register.rows[0]?.value;
  if (!row) throw new Error("Missing source");
  row.payee = "";
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Row treatment"))).toHaveLength(2);
});

it("backs from a future-row decision to its treatment menu", async () => {
  const f = fixture(["rows", "1", "posted", "back", "back", "back", "back"]);
  const row = f.sources.register.rows[0]?.value;
  if (!row) throw new Error("Missing source");
  row.occurredOn = "2026-11-01";
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Row treatment"))).toHaveLength(2);
});

it("backs from warning coverage History to the warning chooser", async () => {
  const f = fixture(["warnings", "2", "back", "back", "back"]);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(
    f.questions.filter((question) => question.includes("Select warning or blocker")),
  ).toHaveLength(2);
});

it("backs from compatible-account selection to the source row chooser", async () => {
  const f = fixture(["rows", "1", "back", "back", "back"]);
  const mapping = f.decisions[0];
  if (!mapping || mapping.tag !== "account") throw new Error("Missing mapping");
  mapping.key = "group:secret";
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Select source row"))).toHaveLength(2);
});

it("backs from an observation row chooser to the observation action", async () => {
  const f = fixture(
    ["observations", "1", "edit-row", "back", "back", "back", "back", "back"],
    "tracking",
  );
  f.decisions.push({
    tag: "observation",
    key: "observation:test",
    accountKey: "account:1",
    rowKey: "row:secret",
    date: "2026-10-24",
    cents: 50000,
  });
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.questions.filter((question) => question.includes("Observation action"))).toHaveLength(2);
});

it("backs from a warning row chooser to the warning list", async () => {
  const f = fixture([]);
  f.decisions.push({
    tag: "row",
    key: "row:secret",
    accountKey: "account:1",
    treatment: "pending",
    postedOn: null,
    role: "transaction",
    payee: "",
  });
  const issueIndex = f.session
    .read()
    .derived.issues.findIndex((issue) => issue.reason === "missing-payee");
  const answers = ["warnings", String(issueIndex + 1), "back", "back", "back", "back"];
  f.session.prompts.ask = async (question) => {
    f.questions.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${question}`);
    return answer;
  };
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(
    f.questions.filter((question) => question.includes("Select warning or blocker")),
  ).toHaveLength(2);
});

it("backs from existing observation evidence account selection to its observation action", async () => {
  const f = fixture(
    ["observations", "1", "edit-evidence", "back", "back", "back", "back"],
    "tracking",
  );
  f.decisions.push({
    tag: "observation",
    key: "observation:test",
    accountKey: "account:1",
    rowKey: "row:secret",
    date: "2026-10-24",
    cents: 50000,
  });
  const before = structuredClone(f.decisions);
  await reviewEvidence(f.session);
  expect(f.changes).toEqual([]);
  expect(f.decisions).toEqual(before);
  expect(f.questions.filter((question) => question.includes("Observation action"))).toHaveLength(2);
});

function openingConflict() {
  const f = fixture([]);
  f.decisions.push(
    { tag: "opening", accountKey: "account:1", date: "2026-10-29", cents: 10882 },
    {
      tag: "row",
      key: "row:secret",
      accountKey: "account:1",
      treatment: "posted",
      postedOn: "2026-10-23",
      role: "transaction",
      payee: "Demo shop",
    },
  );
  return f;
}

it("shows one actionable opening conflict while retaining both raw safety checks", () => {
  const f = openingConflict();
  const view = f.session.read();
  expect(
    view.derived.issues.filter((issue) => issue.reason === "posting-in-opening-period"),
  ).toHaveLength(2);
  const shown = visibleReviewIssues(view);
  const conflicts = shown.filter((issue) => issue.reason === "posting-in-opening-period");
  expect(conflicts).toHaveLength(1);
  const conflict = conflicts[0];
  if (!conflict) throw new Error("Missing conflict");
  const explanation = reviewIssueDetails(view, conflict);
  expect(explanation).toContain("2026-10-23");
  expect(explanation).toContain("2026-10-29");
  expect(explanation).toContain("counted twice");
  expect(explanation).toContain("history");
  expect(explanation).toContain("bank evidence");
  expect(view.derived.ready).toBe(false);
});

it("explains split uncertainty as a nonblocking export limit without asking for repairs", async () => {
  const f = fixture(["warnings", "3", "back", "back", "save"]);
  await reviewEvidence(f.session);
  const output = f.output.join("\n");
  expect(output).toContain("one purchase divided across categories");
  expect(output).toContain("No action is required");
  expect(output).toContain("does not prove that your data contains splits");
  expect(output).not.toContain("cannot remove this blocker");
  expect(f.changes).toEqual([]);
});

it("shows that history acknowledgement is acceptance rather than restored coverage", () => {
  const f = fixture([]);
  const before = f.session.read();
  f.decisions.push({ tag: "ack", key: "history:account:1" });
  const after = f.session.read();
  const warning = after.derived.issues.find(
    (issue) => issue.reason === "unverified-history-coverage",
  );
  if (!warning) throw new Error("Missing warning");
  expect(reviewIssueDetails(after, warning)).toContain("Acknowledged");
  expect(reviewIssueDetails(after, warning)).toContain("does not prove complete history");
  expect(reviewIssueChanges(before, after).join(" ")).toContain("Acknowledged");
  expect(reviewIssueChanges(before, after).join(" ")).toContain("warning remains");
});

it("reports the cleared row blocker and new history acknowledgement after keeping an opening-period purchase as history", () => {
  const f = openingConflict();
  const before = f.session.read();
  const decision = f.decisions.find((entry) => entry.tag === "row");
  if (!decision || decision.tag !== "row") throw new Error("Missing row decision");
  decision.treatment = "history";
  decision.postedOn = null;
  const after = f.session.read();
  const messages = reviewIssueChanges(before, after).join("\n");
  expect(messages).toContain("Cleared blocker");
  expect(messages).toContain("Demo shop");
  expect(messages).toContain("New blocker");
  expect(messages).toContain("History completeness");
  expect(after.derived.rows[0]?.disposition).toBe("history-only");
  expect(before.derived.issues.filter((issue) => issue.blocking)).toHaveLength(2);
});

it("keeps a standalone account blocker visible and does not change raw issues", () => {
  const f = openingConflict();
  const view = f.session.read();
  view.derived.issues = view.derived.issues.filter((issue) => issue.rowKey === null);
  const before = structuredClone(view);
  expect(
    visibleReviewIssues(view).some((issue) => issue.reason === "posting-in-opening-period"),
  ).toBe(true);
  expect(view).toEqual(before);
});

it("does not report a saved outcome when no issue changed", () => {
  const f = openingConflict();
  const view = f.session.read();
  expect(reviewIssueChanges(view, view)).toEqual([]);
});

it("identifies the transaction and dates for a standalone account conflict masked by missing payee", () => {
  const f = openingConflict();
  const row = f.decisions.find((entry) => entry.tag === "row");
  if (!row || row.tag !== "row") throw new Error("Missing row");
  row.payee = "";
  const before = f.session.read();
  const conflict = visibleReviewIssues(before).find(
    (issue) => issue.reason === "posting-in-opening-period",
  );
  if (!conflict) throw new Error("Missing account conflict");
  expect(conflict.rowKey).toBeNull();
  expect(reviewIssueDetails(before, conflict)).toContain("No payee");
  expect(reviewIssueDetails(before, conflict)).toContain("posting date 2026-10-23");
  expect(reviewIssueDetails(before, conflict)).toContain("opening balance date 2026-10-29");
  row.payee = "Corrected shop";
  const messages = reviewIssueChanges(before, f.session.read());
  expect(
    messages.some(
      (message) =>
        message.startsWith("Cleared blocker") && message.includes("Posting date overlaps"),
    ),
  ).toBe(false);
  expect(
    messages.some(
      (message) => message.startsWith("New blocker") && message.includes("Posting date overlaps"),
    ),
  ).toBe(false);
});

it("reports a newly overlapping second row even when another row already caused an account conflict", () => {
  const f = openingConflict();
  const first = f.decisions.find((entry) => entry.tag === "row");
  if (!first || first.tag !== "row") throw new Error("Missing first row");
  first.payee = "";
  const source = f.sources.register.rows[0];
  if (!source?.value) throw new Error("Missing source");
  f.sources.register.rows.push({
    ...structuredClone(source),
    key: "row:second",
    ordinal: 3,
    value: { ...source.value, ordinal: 3, payee: "Second shop" },
  });
  f.decisions.push({
    tag: "row",
    key: "row:second",
    accountKey: "account:1",
    treatment: "pending",
    postedOn: null,
    role: "transaction",
    payee: "Second shop",
  });
  const before = f.session.read();
  const second = f.decisions.find((entry) => entry.tag === "row" && entry.key === "row:second");
  if (!second || second.tag !== "row") throw new Error("Missing second row");
  second.treatment = "posted";
  second.postedOn = "2026-10-23";
  expect(reviewIssueChanges(before, f.session.read())).toContain(
    "New blocker: Demo account | Second shop | Posting date overlaps opening balance.",
  );
});
