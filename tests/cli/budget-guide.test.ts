import { describe, it, expect } from "vitest";
import { guideBudgetActivation } from "../../src/cli/budget-guide.js";
import type { BudgetReview } from "../../src/bootstrap.js";
import type { BudgetSnapshot } from "../../src/application/budget-ports.js";
const review: BudgetReview = {
  format: 1,
  id: "r",
  revision: 1,
  targetPath: "/synthetic/db",
  targetId: "target",
  targetDevice: "1",
  targetInode: "1",
  baseline: "{}",
  expectedBudgetRevision: 0,
  month: "2026-11",
  mode: "activate",
  facts: null,
  coverage: null,
  preview: null,
  answers: [],
};
const snapshot: BudgetSnapshot = {
  targetId: "target",
  setupState: "fresh",
  state: null,
  accounts: [],
  transactions: [],
  sourceRows: [],
};
describe("activation guide", () => {
  it("asks explicit zero values and saves answers; help does not save", async () => {
    const answers = ["help", "0", "0", "opening evidence", "no", "0", "coverage evidence", "yes"];
    let saves = 0;
    const result = await guideBudgetActivation(
      review,
      snapshot,
      {
        interactive: true,
        ask: async () => {
          const answer = answers.shift();
          if (answer === undefined) throw new Error("unexpected prompt");
          return answer;
        },
      },
      "2026-11-05",
      () => {
        saves++;
      },
    );
    expect(result.facts?.opening.readyToAssignCents).toBe(0);
    expect(result.facts?.assignments).toEqual([]);
    expect(result.coverage?.throughDate).toBe("2026-11-05");
    expect(saves).toBe(8);
    expect(result.answers).not.toContain("help");
    expect(result.preview).toBeNull();
  });
});
it("stops when a private save fails", async () => {
  let asks = 0;
  await expect(
    guideBudgetActivation(
      review,
      snapshot,
      {
        interactive: true,
        ask: async () => {
          if (asks++ > 1) throw new Error("unexpected-reprompt");
          return "0";
        },
      },
      "2026-11-05",
      () => {
        throw new Error("save-failure");
      },
    ),
  ).rejects.toThrow("save-failure");
});
it("pairs live transfers once through explicit review choices", async () => {
  const accounts = [
    {
      id: "a",
      name: "Cash A",
      kind: "cash" as const,
      currency: "USD" as const,
      openingCents: 10000,
      openingDate: "2026-10-31",
      revision: 1,
      createdAt: "now",
    },
    {
      id: "b",
      name: "Cash B",
      kind: "cash" as const,
      currency: "USD" as const,
      openingCents: 0,
      openingDate: "2026-10-31",
      revision: 1,
      createdAt: "now",
    },
  ];
  const base = {
    occurredOn: "2026-11-01",
    postedOn: null,
    payee: "Transfer",
    memo: "",
    revision: 1,
    createdAt: "now",
    updatedAt: "now",
  };
  const data = {
    ...snapshot,
    accounts,
    transactions: [
      { ...base, id: "debit", accountId: "a", cents: -1000 },
      { ...base, id: "credit", accountId: "b", cents: 1000 },
    ],
  };
  const answers = [
    "no",
    "100",
    "a evidence",
    "no",
    "0",
    "b evidence",
    "0",
    "100",
    "equation",
    "no",
    "transfer",
    "credit",
    "no",
    "0",
    "coverage",
    "yes",
  ];
  const result = await guideBudgetActivation(
    review,
    data,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (value === undefined) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.facts?.events).toEqual([
    {
      kind: "transfer",
      id: "reviewed-transfer:debit:credit",
      sourceId: "transfer|debit|credit",
      date: "2026-11-01",
      order: 0,
      fromAccountId: "a",
      toAccountId: "b",
      amountCents: 1000,
      categoryId: null,
    },
  ]);
});
it("lets a completed review keep saved choices without replaying or saving", async () => {
  const completed: BudgetReview = {
    ...review,
    answers: ["0", "0", "evidence", "no", "0", "coverage", "yes"],
    facts: {
      startMonth: "2026-11",
      currency: "USD",
      opening: {
        accounts: [],
        categories: [],
        readyToAssignCents: 0,
        evidence: "evidence",
        deficitAcknowledged: false,
      },
      categories: [],
      assignments: [],
      events: [],
    },
    coverage: {
      throughDate: "2026-11-05",
      evidence: "coverage",
      includedTransactionIds: [],
      postedBridgeEventIds: [],
    },
  };
  let asks = 0,
    saves = 0;
  const result = await guideBudgetActivation(
    completed,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        asks++;
        return "done";
      },
    },
    "2026-11-05",
    () => {
      saves++;
    },
  );
  expect(result).toEqual(completed);
  expect(asks).toBe(1);
  expect(saves).toBe(0);
});
it("back keeps earlier choices and replaces later answers", async () => {
  const answers = ["0", "0", "old evidence", "back", "new evidence", "no", "0", "coverage", "yes"];
  const result = await guideBudgetActivation(
    review,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (value === undefined) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.facts?.opening.evidence).toBe("new evidence");
  expect(result.answers).not.toContain("old evidence");
  expect(result.answers.slice(0, 2)).toEqual(["0", "0"]);
});
it("abandon preserves only the saved valid choices", async () => {
  let saved = review;
  const answers = ["0", "0", "abandon"];
  await expect(
    guideBudgetActivation(
      review,
      snapshot,
      {
        interactive: true,
        ask: async () => {
          const value = answers.shift();
          if (value === undefined) throw new Error("unexpected prompt");
          return value;
        },
      },
      "2026-11-05",
      (value) => {
        saved = value;
      },
    ),
  ).rejects.toThrow();
  expect(saved.answers).toEqual(["0", "0"]);
  expect(saved.facts).toBeNull();
  expect(saved.revision).toBe(3);
});
it("reviews an incoming Tracking transfer with explicit external leg evidence", async () => {
  const data: BudgetSnapshot = {
    ...snapshot,
    accounts: [
      {
        id: "cash",
        name: "Cash",
        kind: "cash",
        currency: "USD",
        openingCents: 0,
        openingDate: "2026-10-31",
        revision: 1,
        createdAt: "now",
      },
      {
        id: "track",
        name: "Tracking",
        kind: "tracking",
        openingCents: null,
        openingDate: null,
        currency: "USD",
        revision: 1,
        createdAt: "now",
      },
    ],
    transactions: [
      {
        id: "inflow",
        accountId: "cash",
        occurredOn: "2026-11-01",
        postedOn: null,
        cents: 1000,
        payee: "Transfer",
        memo: "",
        revision: 1,
        createdAt: "now",
        updatedAt: "now",
      },
    ],
  };
  const answers = [
    "no",
    "0",
    "cash evidence",
    "0",
    "0",
    "equation",
    "no",
    "transfer",
    "tracking:track",
    "external-evidence",
    "no",
    "0",
    "coverage",
    "yes",
  ];
  const result = await guideBudgetActivation(
    review,
    data,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (value === undefined) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.facts?.events[0]).toMatchObject({
    kind: "transfer",
    fromAccountId: "track",
    toAccountId: "cash",
    amountCents: 1000,
    sourceId: "transfer|external-evidence|inflow",
  });
});
it("requires fresh coverage evidence when a completed review resumes on a later day", async () => {
  const completed: BudgetReview = {
    ...review,
    answers: ["0", "0", "evidence", "no", "0", "old coverage", "yes"],
    facts: {
      startMonth: "2026-11",
      currency: "USD",
      opening: {
        accounts: [],
        categories: [],
        readyToAssignCents: 0,
        evidence: "evidence",
        deficitAcknowledged: false,
      },
      categories: [],
      assignments: [],
      events: [],
    },
    coverage: {
      throughDate: "2026-11-04",
      evidence: "old coverage",
      includedTransactionIds: [],
      postedBridgeEventIds: [],
    },
  };
  const answers = ["continue", "fresh coverage", "yes"];
  const result = await guideBudgetActivation(
    completed,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (value === undefined) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.coverage?.evidence).toBe("fresh coverage");
  expect(result.coverage?.throughDate).toBe("2026-11-05");
});
it("composes canonical paired source references for imported historical transfers", async () => {
  const data: BudgetSnapshot = {
    ...snapshot,
    accounts: [
      {
        id: "cash-a",
        name: "Cash A",
        kind: "cash",
        currency: "USD",
        openingCents: 10000,
        openingDate: "2026-10-31",
        revision: 1,
        createdAt: "now",
      },
      {
        id: "cash-b",
        name: "Cash B",
        kind: "cash",
        currency: "USD",
        openingCents: 0,
        openingDate: "2026-10-31",
        revision: 1,
        createdAt: "now",
      },
    ],
    sourceRows: [
      {
        id: "debit-row",
        accountId: "cash-a",
        date: "2026-11-01",
        cents: -1000,
        role: "transaction",
        transactionId: null,
      },
      {
        id: "credit-row",
        accountId: "cash-b",
        date: "2026-11-01",
        cents: 1000,
        role: "transaction",
        transactionId: null,
      },
    ],
  };
  const answers = [
    "no",
    "100",
    "a evidence",
    "no",
    "0",
    "b evidence",
    "0",
    "100",
    "equation",
    "no",
    "1",
    "transfer",
    "paired",
    "reviewed transfer",
    "2026-11-01",
    "10",
    "cash-a",
    "cash-b",
    "no",
    "imported",
    "debit-row",
    "credit-row",
    "no",
    "coverage",
    "yes",
  ];
  const result = await guideBudgetActivation(
    review,
    data,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (value === undefined) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.facts?.events[0]?.sourceId).toBe("history|debit-row|credit-row");
});
