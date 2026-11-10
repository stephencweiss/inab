import { describe, it, expect, vi } from "vitest";
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
  answerThroughDate: "2026-11-05",
  draft: null,
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
  it("explains closed state and boundary evidence without changing saved choices during help", async () => {
    const writes: string[] = [];
    const output = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const data = {
      ...snapshot,
      accounts: [
        {
          id: "card",
          name: "Synthetic card",
          kind: "credit" as const,
          currency: "USD" as const,
          openingCents: 0,
          openingDate: "2026-09-30",
          revision: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    };
    const answers = [
      "help",
      "0",
      "no",
      "0.00",
      "help",
      "Synthetic September statement",
      "0",
      "0",
      "Opening equation",
      "no",
      "0",
      "Complete activity",
      "yes",
    ];
    let saves = 0;
    try {
      const result = await guideBudgetActivation(
        { ...review, month: "2026-10" },
        data,
        {
          interactive: true,
          ask: async (label) => {
            if (label.startsWith("Was Synthetic card") && answers[0] === "no")
              expect(saves).toBe(0);
            if (
              label.startsWith("Independent boundary") &&
              answers[0] === "Synthetic September statement"
            )
              expect(saves).toBe(2);
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
      const help = writes.filter((v) => v.includes("Back returns"));
      expect(help).toHaveLength(2);
      expect(help[0]).toContain("2026-09-30");
      expect(help[0]).toContain("yes or y");
      expect(help[0]).toContain("no or n");
      expect(help[0]).not.toMatch(/Zero|signed USD|reviewed value/);
      expect(help[1]).toContain("statement");
      expect(help[1]).toContain("balance");
      expect(help[1]).not.toMatch(/Zero|signed USD|reviewed value/);
      expect(result.facts?.opening.accounts[0]?.closed).toBe(false);
      expect(result.facts?.opening.accounts[0]?.evidence).toBe("Synthetic September statement");
      expect(result.answers).not.toContain("help");
    } finally {
      output.mockRestore();
    }
  });
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
it("quit preserves only the saved valid choices", async () => {
  let saved = review;
  const answers = ["0", "0", "quit"];
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

describe("saved review controls", () => {
  it("shows the question with each saved answer, including legacy reviews", async () => {
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const answers = ["edit", "abandon"];
    const save = vi.fn();
    try {
      await expect(
        guideBudgetActivation(
          { ...review, answers: ["0", "20", "statement totals", "no"] },
          snapshot,
          {
            interactive: true,
            ask: async () => {
              const answer = answers.shift();
              if (!answer) throw new Error("unexpected repeat");
              return answer;
            },
          },
          "2026-11-05",
          save,
        ),
      ).rejects.toThrow();
      const text = output.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(text).toContain("1: Number of budget categories");
      expect(text).toContain("2: Opening Ready to Assign; signed USD: 20");
      expect(text).toContain("3: Opening equation evidence: statement totals");
      expect(save.mock.calls.at(-1)?.[0].answers).toEqual([]);
    } finally {
      output.mockRestore();
    }
  });
  it("abandon clears saved review values, while quit preserves them", async () => {
    const save = vi.fn();
    let quitPrompts = 0;
    const saved = { ...review, answers: ["0", "20"] };
    await expect(
      guideBudgetActivation(
        saved,
        snapshot,
        { interactive: true, ask: async () => "abandon" },
        "2026-11-05",
        save,
      ),
    ).rejects.toThrow();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: [],
        draft: null,
        facts: null,
        coverage: null,
        preview: null,
      }),
    );
    save.mockClear();
    await expect(
      guideBudgetActivation(
        saved,
        snapshot,
        {
          interactive: true,
          ask: async () => {
            if (quitPrompts++) throw new Error("unexpected repeat");
            return "quit";
          },
        },
        "2026-11-05",
        save,
      ),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it("abandon during a question clears saved answers", async () => {
    const answers = ["0", "abandon"];
    const save = vi.fn();
    await expect(
      guideBudgetActivation(
        review,
        snapshot,
        {
          interactive: true,
          ask: async () => {
            const answer = answers.shift();
            if (!answer) throw new Error("unexpected repeat");
            return answer;
          },
        },
        "2026-11-05",
        save,
      ),
    ).rejects.toThrow();
    expect(save.mock.calls.at(-1)?.[0].answers).toEqual([]);
  });
});

it("edits JSON, saves it as an unfinished draft on no, and can resume it", async () => {
  let saved = review;
  const answers = ["0", "0", "evidence", "no", "0", "coverage", "edit", "no"];
  const editor = vi.fn(
    async (value: {
      facts: NonNullable<BudgetReview["facts"]>;
      coverage: NonNullable<BudgetReview["coverage"]>;
    }) => ({
      ...value,
      facts: { ...value.facts, opening: { ...value.facts.opening, evidence: "corrected note" } },
    }),
  );
  const result = await guideBudgetActivation(
    review,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected prompt");
        return answer;
      },
    },
    "2026-11-05",
    (next) => {
      saved = next;
    },
    editor,
  );
  expect(editor).toHaveBeenCalledOnce();
  expect(result.facts).toBeNull();
  expect(saved.draft?.facts.opening.evidence).toBe("corrected note");
  const resume = ["continue", "yes"];
  const complete = await guideBudgetActivation(
    saved,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const answer = resume.shift();
        if (!answer) throw new Error("unexpected prompt");
        return answer;
      },
    },
    "2026-11-05",
    () => {},
    editor,
  );
  expect(complete.facts?.opening.evidence).toBe("corrected note");
  expect(complete.draft).toBeNull();
});

it("generates category IDs while keeping names separate and editable", async () => {
  const prompts: string[] = [];
  const answers = [
    "1",
    "Housing",
    "Fixed",
    "no",
    "0",
    "none",
    "0",
    "equation",
    "no",
    "0",
    "0",
    "coverage",
    "yes",
  ];
  const result = await guideBudgetActivation(
    review,
    snapshot,
    {
      interactive: true,
      ask: async (label) => {
        prompts.push(label);
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected prompt");
        return answer;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(prompts.some((label) => label.includes("stable ID"))).toBe(false);
  expect(result.facts?.categories).toEqual([
    { id: "category:r:1", name: "Housing", groupId: "Fixed", cardAccountId: null, archived: false },
  ]);
  expect(result.facts?.assignments[0]?.categoryId).toBe("category:r:1");
});

it("keeps legacy category IDs when replaying saved answers", async () => {
  const legacy = {
    ...review,
    answers: [
      "1",
      "housing",
      "Fixed",
      "Fixed",
      "no",
      "0",
      "prior balance",
      "0",
      "equation",
      "no",
      "0",
      "0",
      "coverage",
    ],
  };
  const answers = ["continue", "edit", "yes"];
  const editor = vi.fn(
    async (value: {
      facts: NonNullable<BudgetReview["facts"]>;
      coverage: NonNullable<BudgetReview["coverage"]>;
    }) => ({
      ...value,
      facts: {
        ...value.facts,
        categories: value.facts.categories.map((c) => ({ ...c, name: "Housing" })),
      },
    }),
  );
  const result = await guideBudgetActivation(
    legacy,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected prompt");
        return answer;
      },
    },
    "2026-11-05",
    () => {},
    editor,
  );
  expect(result.facts?.categories[0]).toMatchObject({
    id: "housing",
    name: "Housing",
    groupId: "Fixed",
  });
});

it("back skips a generated category ID and returns to category count", async () => {
  const answers = ["1", "back", "0", "0", "equation", "no", "0", "coverage", "yes"];
  const result = await guideBudgetActivation(
    review,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const answer = answers.shift();
        if (!answer) throw new Error("unexpected prompt");
        return answer;
      },
    },
    "2026-11-05",
    () => {},
  );
  expect(result.facts?.categories).toEqual([]);
});

it("stops if saving an accepted JSON edit fails", async () => {
  const answers = ["0", "0", "evidence", "no", "0", "coverage", "edit"];
  const editor = vi.fn(
    async (value: {
      facts: NonNullable<BudgetReview["facts"]>;
      coverage: NonNullable<BudgetReview["coverage"]>;
    }) => ({
      ...value,
      facts: { ...value.facts, opening: { ...value.facts.opening, evidence: "edited" } },
    }),
  );
  await expect(
    guideBudgetActivation(
      review,
      snapshot,
      {
        interactive: true,
        ask: async () => {
          const answer = answers.shift();
          if (!answer) throw new Error("unexpected-reprompt");
          return answer;
        },
      },
      "2026-11-05",
      (next) => {
        if (next.draft?.facts.opening.evidence === "edited") throw new Error("save-failure");
      },
      editor,
    ),
  ).rejects.toThrow("save-failure");
});

it("keeps saved answer positions across a month change", async () => {
  const saved = {
    ...review,
    answerThroughDate: "2026-11-05",
    answers: [
      "1",
      "housing",
      "Housing",
      "Fixed",
      "no",
      "0",
      "zero",
      "0",
      "equation",
      "no",
      "100",
      "0",
      "November checked",
      "no",
    ],
  };
  const answers = ["continue", "50", "December checked", "yes"];
  const result = await guideBudgetActivation(
    saved,
    snapshot,
    {
      interactive: true,
      ask: async () => {
        const value = answers.shift();
        if (!value) throw new Error("unexpected prompt");
        return value;
      },
    },
    "2026-12-01",
    () => {},
  );
  expect(result.facts?.assignments).toEqual([
    { month: "2026-11", categoryId: "housing", amountCents: 10000 },
    { month: "2026-12", categoryId: "housing", amountCents: 5000 },
  ]);
  expect(result.coverage?.evidence).toBe("December checked");
});
it("asks for the answer horizon of a legacy unfinished review before replay", async () => {
  const answers = ["edit", "2026-11-05", "quit"];
  const labels: string[] = [];
  const saved = {
    ...review,
    answerThroughDate: null,
    answers: [
      "1",
      "housing",
      "Housing",
      "Fixed",
      "no",
      "0",
      "zero",
      "0",
      "equation",
      "no",
      "100",
      "0",
      "November checked",
      "no",
    ],
  };
  await expect(
    guideBudgetActivation(
      saved,
      snapshot,
      {
        interactive: true,
        ask: async (label) => {
          labels.push(label);
          const value = answers.shift();
          if (!value) throw new Error("unexpected prompt");
          return value;
        },
      },
      "2026-12-01",
      () => {},
    ),
  ).rejects.toThrow();
  expect(labels[1]).toContain("date");
  expect(labels[2]).toContain("Answer number");
});

it("abandon at the save summary clears the unfinished JSON draft", async () => {
  const answers = ["0", "0", "checked", "no", "0", "complete", "abandon"];
  let saved = review;
  await expect(
    guideBudgetActivation(
      review,
      snapshot,
      {
        interactive: true,
        ask: async () => {
          const value = answers.shift();
          if (!value) throw new Error("unexpected prompt");
          return value;
        },
      },
      "2026-11-05",
      (value) => {
        saved = value;
      },
    ),
  ).rejects.toThrow();
  expect(saved.answers).toEqual([]);
  expect(saved.draft).toBeNull();
  expect(saved.facts).toBeNull();
  expect(saved.coverage).toBeNull();
  expect(saved.preview).toBeNull();
  expect(saved.answerThroughDate).toBeNull();
});
