import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
  readdirSync,
  truncateSync,
} from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { createBudgetEditor } from "../../src/adapters/budget/editor.js";
import { parseBudgetFacts } from "../../src/budget/parse.js";
import { parseBudgetCoverage } from "../../src/adapters/budget/review-file.js";
import type { BudgetCommand } from "../../src/application/budget-ports.js";
type Facts = Extract<BudgetCommand, { kind: "activate" }>["facts"];
const facts: Facts = {
  startMonth: "2026-11",
  currency: "USD",
  opening: {
    accounts: [],
    categories: [],
    readyToAssignCents: 0,
    evidence: "Synthetic zero",
    deficitAcknowledged: false,
  },
  categories: [],
  assignments: [],
  events: [],
};
const draft = {
  facts,
  coverage: {
    throughDate: "2026-11-05",
    evidence: "Synthetic complete",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  },
};
function parseDraft(value: object) {
  if (!("facts" in value) || !("coverage" in value)) throw new Error("invalid-editable-budget");
  const parsed = parseBudgetFacts(value.facts);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { facts: parsed.value, coverage: parseBudgetCoverage(value.coverage) };
}
const edit = createBudgetEditor(parseDraft);
it("uses a private isolated file and returns validated editable values", async () => {
  let path = "";
  const result = await edit(draft, async (file) => {
    path = file;
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(lstatSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(file))).toEqual(["draft.json"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(draft);
    writeFileSync(
      file,
      JSON.stringify({ ...draft, coverage: { ...draft.coverage, evidence: "Edited evidence" } }),
    );
    return 0;
  });
  expect(result?.coverage.evidence).toBe("Edited evidence");
  expect(existsSync(dirname(path))).toBe(false);
  expect(draft.coverage.evidence).toBe("Synthetic complete");
});
it("cancels without reading invalid edits and removes the temporary directory", async () => {
  let path = "";
  const result = await edit(draft, async (file) => {
    path = file;
    writeFileSync(file, "invalid");
    return 1;
  });
  expect(result).toBeNull();
  expect(existsSync(dirname(path))).toBe(false);
});
it("rejects metadata injection, malformed JSON and invalid relationships without changing the original", async () => {
  for (const value of [
    "{",
    JSON.stringify({ ...draft, targetPath: "/synthetic/other" }),
    JSON.stringify({
      ...draft,
      facts: {
        ...facts,
        categories: [
          {
            id: "missing",
            groupId: "living",
            name: "Missing",
            archived: false,
            cardAccountId: null,
          },
        ],
      },
    }),
  ]) {
    let path = "";
    await expect(
      edit(draft, async (file) => {
        path = file;
        writeFileSync(file, value);
        return 0;
      }),
    ).rejects.toThrow();
    expect(existsSync(dirname(path))).toBe(false);
  }
  expect(draft.facts).toEqual(facts);
});
it("rejects a symlink editor result and cleans up on editor errors", async () => {
  let path = "";
  await expect(
    edit(draft, async (file) => {
      path = file;
      unlinkSync(file);
      symlinkSync("/synthetic/other", file);
      return 0;
    }),
  ).rejects.toThrow();
  expect(existsSync(dirname(path))).toBe(false);
  await expect(
    edit(draft, async () => {
      throw new Error("editor-runner-failure");
    }),
  ).rejects.toThrow("editor-runner-failure");
});

it("refuses oversized editor output and removes it", async () => {
  let path = "";
  await expect(
    edit(draft, async (file) => {
      path = file;
      truncateSync(file, 64 * 1024 * 1024 + 1);
      return 0;
    }),
  ).rejects.toThrow("input-limit");
  expect(existsSync(dirname(path))).toBe(false);
});
it("rejects unknown editable fields at every nested facts and coverage boundary", async () => {
  const account = {
    accountId: "cash",
    kind: "cash" as const,
    balanceCents: 0,
    closed: false,
    evidence: "Synthetic zero",
  };
  const category = {
    id: "food",
    groupId: "living",
    name: "Food",
    archived: false,
    cardAccountId: null,
  };
  const openingCategory = { categoryId: "food", availableCents: 0, evidence: "Synthetic zero" };
  const assignment = { month: "2026-11", categoryId: "food", amountCents: 0 };
  const line = { categoryId: "food", amountCents: 100 };
  const event = {
    kind: "transaction" as const,
    id: "event",
    sourceId: "manual:evidence",
    date: "2026-11-01",
    order: 0,
    accountId: "cash",
    amountCents: 100,
    allocation: { kind: "categories" as const, lines: [line] },
  };
  const complete = {
    ...facts,
    opening: { ...facts.opening, accounts: [account], categories: [openingCategory] },
    categories: [category],
    assignments: [assignment],
    events: [event],
  };
  const values = [
    { ...draft, facts: { ...complete, startMont: "2026-11" } },
    { ...draft, facts: { ...complete, opening: { ...complete.opening, readyToAssignCent: 0 } } },
    {
      ...draft,
      facts: {
        ...complete,
        opening: { ...complete.opening, accounts: [{ ...account, balanceCent: 0 }] },
      },
    },
    {
      ...draft,
      facts: {
        ...complete,
        opening: { ...complete.opening, categories: [{ ...openingCategory, availableCent: 0 }] },
      },
    },
    { ...draft, facts: { ...complete, categories: [{ ...category, archive: false }] } },
    { ...draft, facts: { ...complete, assignments: [{ ...assignment, amountCent: 0 }] } },
    { ...draft, facts: { ...complete, events: [{ ...event, amountCent: 100 }] } },
    {
      ...draft,
      facts: { ...complete, events: [{ ...event, allocation: { ...event.allocation, line: [] } }] },
    },
    {
      ...draft,
      facts: {
        ...complete,
        events: [
          { ...event, allocation: { ...event.allocation, lines: [{ ...line, amountCent: 100 }] } },
        ],
      },
    },
    { ...draft, facts: complete, coverage: { ...draft.coverage, throughDat: "2026-11-05" } },
  ];
  for (const value of values)
    await expect(
      edit(draft, async (file) => {
        writeFileSync(file, JSON.stringify(value));
        return 0;
      }),
    ).rejects.toThrow("unknown-budget-editor-field");
});
