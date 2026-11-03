import { describe, expect, it, vi, afterEach } from "vitest";
import {
  choice,
  keepSaved,
  historyAction,
  accountClosed,
  saveChoice,
  startReview,
  confirm,
  dateAnswer,
  moneyAnswer,
  text,
} from "../../src/cli/migration-questions.js";
afterEach(() => vi.restoreAllMocks());

import { PromptCancelled } from "../../src/cli/prompts.js";

function scripted(answers: string[]) {
  const questions: string[] = [];
  return {
    questions,
    prompts: {
      interactive: true,
      ask: async (question: string) => {
        questions.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error("No synthetic answer remains");
        return answer;
      },
    },
  };
}

describe("migration questions", () => {
  it("lists choices, retries invalid input and normalizes case and spaces", async () => {
    const { prompts, questions } = scripted(["", "other", "  CREDIT  "]);
    expect(await choice(prompts, "Account kind", ["cash", "credit", "tracking"])).toBe("credit");
    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(question).toContain("cash, credit, [t]racking, [h]elp, [a]bandon");
    }
    expect(questions[1]).toContain("Invalid");
  });

  it("requires nonblank text and preserves case while trimming", async () => {
    const { prompts, questions } = scripted(["  ", "  Demo Cash  "]);
    expect(await text(prompts, "Local name")).toBe("Demo Cash");
    expect(questions).toHaveLength(2);
    expect(questions[0]).toContain("required text");
    expect(questions[0]).toContain("[a]bandon");
  });

  it("shows the text default and accepts a blank answer", async () => {
    const { prompts, questions } = scripted(["  "]);
    expect(await text(prompts, "Local name", "Demo Cash")).toBe("Demo Cash");
    expect(questions[0]).toContain("[Demo Cash]");
  });

  it("shows the date format and retries malformed, impossible and future dates", async () => {
    const { prompts, questions } = scripted([
      "10/29/2026",
      "2026-02-29",
      "2026-10-30",
      " 2026-10-28 ",
    ]);
    expect(await dateAnswer(prompts, "Opening date", "2026-10-29")).toBe("2026-10-28");
    expect(questions).toHaveLength(4);
    for (const question of questions) {
      expect(question).toContain("YYYY-MM-DD");
      expect(question).toContain("2026-10-29");
      expect(question).toContain("[h]elp");
      expect(question).toContain("[a]bandon");
    }
  });

  it("uses today's date for a blank answer", async () => {
    const { prompts } = scripted([""]);
    expect(await dateAnswer(prompts, "Opening date", "2026-10-29")).toBe("2026-10-29");
  });

  it("accepts a valid leap date", async () => {
    const { prompts } = scripted(["2024-02-29"]);
    expect(await dateAnswer(prompts, "Opening date", "2026-10-29")).toBe("2024-02-29");
  });

  it("shows signed USD examples and retries invalid or unsafe amounts", async () => {
    const { prompts, questions } = scripted([
      "",
      "$12.34",
      "1.234",
      "90071992547410.00",
      " -12.34 ",
    ]);
    expect(await moneyAnswer(prompts, "Opening balance")).toBe(-1234);
    expect(questions).toHaveLength(5);
    for (const question of questions) {
      expect(question).toContain("USD");
      expect(question).toContain("12.34");
      expect(question).toContain("-12.34");
      expect(question).toContain("[h]elp");
      expect(question).toContain("[a]bandon");
    }
  });

  it.each([
    ["0", 0],
    ["12.3", 1230],
    ["12", 1200],
  ])("parses amount %s as cents", async (answer, expected) => {
    const { prompts } = scripted([String(answer)]);
    expect(await moneyAnswer(prompts, "Balance")).toBe(expected);
  });

  it.each([
    [" YES ", true],
    [" No ", false],
  ])("requires an explicit yes or no: %s", async (answer, expected) => {
    const { prompts, questions } = scripted(["", "maybe", String(answer)]);
    expect(await confirm(prompts, "Save this choice?")).toBe(expected);
    expect(questions).toHaveLength(3);
    for (const question of questions) expect(question).toContain("[y]es, [n]o, [h]elp, [a]bandon");
  });

  it("cancels each question after trimming and case normalization", async () => {
    const calls = [
      () => choice(scripted([" Cancel "]).prompts, "Kind", ["cash"]),
      () => text(scripted([" CANCEL "]).prompts, "Name"),
      () => dateAnswer(scripted([" cancel "]).prompts, "Date", "2026-10-29"),
      () => moneyAnswer(scripted([" Cancel "]).prompts, "Balance"),
      () => confirm(scripted([" Cancel "]).prompts, "Save?"),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("preserves cancellation from the terminal", async () => {
    await expect(
      text(
        {
          interactive: true,
          ask: async () => {
            throw new PromptCancelled();
          },
        },
        "Name",
      ),
    ).rejects.toBeInstanceOf(PromptCancelled);
  });
});

describe("start migration review", () => {
  it.each(["", "  ", "c", "C", "continue", " Continue "])("continues for %j", async (value) => {
    const { prompts, questions } = scripted([value]);
    expect(await startReview(prompts)).toBe(true);
    expect(questions).toEqual([
      "--> Start migration review ([c]ontinue (default), [d]one, [h]elp, [a]bandon): ",
    ]);
  });
  it.each(["d", "D", "done"])("finishes for %j", async (value) => {
    expect(await startReview(scripted([value]).prompts)).toBe(false);
  });
  it.each(["a", "A", "abandon", " Abandon ", "cancel"])(
    "abandons for %j without a destructive action",
    async (value) => {
      await expect(startReview(scripted([value]).prompts)).rejects.toBeInstanceOf(PromptCancelled);
    },
  );
  it("repeats the same prompt after invalid input", async () => {
    const { prompts, questions } = scripted(["wrong", ""]);
    expect(await startReview(prompts)).toBe(true);
    expect(questions[1]).toBe(
      "--> Invalid choice. Start migration review ([c]ontinue (default), [d]one, [h]elp, [a]bandon): ",
    );
  });
});

it("offers abandon for a question that uses that exit label", async () => {
  const { prompts, questions } = scripted(["abandon"]);
  await expect(
    choice(prompts, "Account kind", ["cash", "credit", "tracking"], "abandon"),
  ).rejects.toBeInstanceOf(PromptCancelled);
  expect(questions).toEqual(["--> Account kind (cash, credit, [t]racking, [h]elp, [a]bandon): "]);
});

describe("account closed question", () => {
  it.each(["", "  ", "n", "N", "no", " No "])("keeps the account open for %j", async (value) => {
    const { prompts, questions } = scripted([value]);
    expect(await accountClosed(prompts)).toBe(false);
    expect(questions).toEqual([
      "--> Is this account closed? ([n]o (default), [y]es, [h]elp, [a]bandon): ",
    ]);
  });
  it.each(["y", "Y", "yes", " Yes "])("marks it closed for %j", async (value) => {
    expect(await accountClosed(scripted([value]).prompts)).toBe(true);
  });
  it.each(["a", "A", "abandon", " Abandon ", "cancel"])("abandons for %j", async (value) => {
    await expect(accountClosed(scripted([value]).prompts)).rejects.toBeInstanceOf(PromptCancelled);
  });
  it("repeats after invalid input and accepts Enter as no", async () => {
    const { prompts, questions } = scripted(["false", ""]);
    expect(await accountClosed(prompts)).toBe(false);
    expect(questions[1]).toBe(
      "--> Invalid choice. Is this account closed? ([n]o (default), [y]es, [h]elp, [a]bandon): ",
    );
  });
});

describe("save review choice", () => {
  it.each(["", "  ", "y", "Y", "yes", " Yes "])("saves for %j", async (value) => {
    const { prompts, questions } = scripted([value]);
    expect(await saveChoice(prompts)).toBe(true);
    expect(questions).toEqual([
      "--> Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon): ",
    ]);
  });
  it.each(["n", "N", "no", " No "])("does not save for %j", async (value) => {
    expect(await saveChoice(scripted([value]).prompts)).toBe(false);
  });
  it.each(["a", "A", "abandon", " Abandon ", "cancel"])("abandons for %j", async (value) => {
    await expect(saveChoice(scripted([value]).prompts)).rejects.toBeInstanceOf(PromptCancelled);
  });
  it("repeats after invalid input", async () => {
    const { prompts, questions } = scripted(["maybe", ""]);
    expect(await saveChoice(prompts)).toBe(true);
    expect(questions[1]).toBe(
      "--> Invalid choice. Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon): ",
    );
  });
});

describe("term help at migration questions", () => {
  it.each(["h", "H", "help", " HELP "])(
    "explains closing balance and keeps the same date prompt for %j",
    async (help) => {
      const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const { prompts, questions } = scripted([help, ""]);
      expect(await dateAnswer(prompts, "Posted closing balance date", "2026-10-30")).toBe(
        "2026-10-30",
      );
      expect(questions[1]).toBe(questions[0]);
      expect(questions[0]).toBe(
        "--> Posted closing balance date (YYYY-MM-DD; on or before 2026-10-30; blank keeps [2026-10-30]; or [h]elp, or [a]bandon): ",
      );
      const definition = output.mock.calls
        .map(([value]) => String(value))
        .join("")
        .toLowerCase();
      expect(definition).toContain("closing balance");
      expect(definition).toContain("pending");
      expect(definition).toContain("today");
      expect(definition).toContain("local");
    },
  );
  it("provides help for every question type without accepting it as an answer", async () => {
    const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cases = [
      {
        answers: ["h", "Demo cash"],
        run: (p: ReturnType<typeof scripted>["prompts"]) => text(p, "Account name"),
        expected: "Demo cash",
      },
      {
        answers: ["h", "cash"],
        run: (p: ReturnType<typeof scripted>["prompts"]) =>
          choice(p, "Account kind", ["cash", "credit", "tracking"], "abandon", "account-kind"),
        expected: "cash",
      },
      {
        answers: ["h", "-250.00"],
        run: (p: ReturnType<typeof scripted>["prompts"]) =>
          moneyAnswer(p, "Opening balance", "opening-balance"),
        expected: -25000,
      },
      {
        answers: ["h", ""],
        run: (p: ReturnType<typeof scripted>["prompts"]) => startReview(p),
        expected: true,
      },
      {
        answers: ["h", ""],
        run: (p: ReturnType<typeof scripted>["prompts"]) => accountClosed(p),
        expected: false,
      },
      {
        answers: ["h", ""],
        run: (p: ReturnType<typeof scripted>["prompts"]) => saveChoice(p),
        expected: true,
      },
      {
        answers: ["h", "Y"],
        run: (p: ReturnType<typeof scripted>["prompts"]) => confirm(p, "Confirm import?"),
        expected: true,
      },
    ];
    for (const c of cases) {
      const { prompts, questions } = scripted(c.answers);
      expect(await c.run(prompts)).toBe(c.expected);
      expect(questions).toHaveLength(2);
      expect(questions[0]).toBe(questions[1]);
      expect(questions[0]).toContain("[h]elp");
    }
    expect(output.mock.calls.length).toBeGreaterThanOrEqual(cases.length);
  });
  it.each(["y", "Y", "yes", "YES"])(
    "accepts explicit confirmation %j without a default",
    async (value) => {
      const { prompts, questions } = scripted(["", value]);
      expect(await confirm(prompts, "Confirm import?")).toBe(true);
      expect(questions).toHaveLength(2);
      expect(questions[0]).not.toContain("default");
    },
  );
  it("accepts unique initials but repeats ambiguous ones", async () => {
    const { prompts, questions } = scripted(["c", "T"]);
    expect(await choice(prompts, "Account kind", ["cash", "credit", "tracking"])).toBe("tracking");
    expect(questions).toHaveLength(2);
  });
  it("abandons from every helper with a case-insensitive shortcut", async () => {
    const calls = [
      () => choice(scripted(["A"]).prompts, "Kind", ["cash"]),
      () => text(scripted(["A"]).prompts, "Name"),
      () => dateAnswer(scripted(["A"]).prompts, "Date", "2026-10-30"),
      () => moneyAnswer(scripted(["A"]).prompts, "Balance"),
      () => confirm(scripted(["A"]).prompts, "Confirm import?"),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(PromptCancelled);
  });
});

describe("history action choices", () => {
  it.each([
    ["h", "history"],
    ["H", "history"],
    ["history", "history"],
    ["e", "edit"],
    ["E", "edit"],
    ["edit", "edit"],
    ["s", "save"],
    ["S", "save"],
    ["save", "save"],
  ])("accepts %s as %s", async (value, expected) => {
    const { prompts, questions } = scripted([value]);
    expect(await historyAction(prompts)).toBe(expected);
    expect(questions).toEqual(["--> Action ([h]istory, [e]dit, [s]ave, [a]bandon, help): "]);
  });
  it("uses full-word help while h selects history", async () => {
    const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { prompts, questions } = scripted(["HELP", "h"]);
    expect(await historyAction(prompts)).toBe("history");
    expect(questions[1]).toBe(questions[0]);
    expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
      "History coverage",
    );
  });
  it.each(["a", "A", "abandon"])("abandons for %s", async (value) => {
    await expect(historyAction(scripted([value]).prompts)).rejects.toBeInstanceOf(PromptCancelled);
  });
});

describe("menu Back controls", () => {
  it.each(["b", "B", "back", " BACK "])(
    "returns the back choice for %j without abandoning",
    async (value) => {
      const { prompts, questions } = scripted([value]);
      expect(
        await choice(
          prompts,
          "Tracking observations",
          ["add", "back", "save"],
          "abandon",
          "observation",
        ),
      ).toBe("back");
      expect(questions[0]).toContain("[b]ack");
      expect(questions[0]).toContain("[a]bandon");
    },
  );
  it("offers back in History only when a parent menu exists", async () => {
    const { prompts, questions } = scripted(["b"]);
    expect(await historyAction(prompts, true)).toBe("back");
    expect(questions[0]).toContain("[b]ack");
    const initial = scripted(["b", "s"]);
    expect(await historyAction(initial.prompts)).toBe("save");
    expect(initial.questions).toHaveLength(2);
    expect(initial.questions[0]).not.toContain("[b]ack");
  });
});

it.each([
  ["k", "keep"],
  ["K", "keep"],
  ["e", "edit"],
  ["E", "edit"],
])("shows saved mapping shortcuts and accepts %s", async (input, expected) => {
  const { prompts, questions } = scripted([input]);
  expect(await choice(prompts, "Saved mapping", ["keep", "edit"])).toBe(expected);
  expect(questions[0]).toBe("--> Saved mapping ([k]eep, [e]dit, [h]elp, [a]bandon): ");
});

describe("visible menu shortcuts", () => {
  it.each([
    { values: ["fresh", "migrate"], hints: "[f]resh, [m]igrate" },
    { values: ["cash", "credit", "tracking"], hints: "cash, credit, [t]racking" },
    { values: ["import", "review", "save"], hints: "[i]mport, [r]eview, [s]ave" },
    {
      values: ["accounts", "rows", "observations", "warnings", "back", "save"],
      hints: "accounts, [r]ows, [o]bservations, [w]arnings, [b]ack, [s]ave",
    },
    { values: ["history", "pending", "posted", "back"], hints: "history, pending, posted, [b]ack" },
    {
      values: ["transaction", "opening", "adjustment", "back"],
      hints: "[t]ransaction, [o]pening, adjustment, [b]ack",
    },
    {
      values: ["mapping", "opening", "back", "save"],
      hints: "[m]apping, [o]pening, [b]ack, [s]ave",
    },
    {
      values: [
        "correct-data",
        "revise-adjustment",
        "defer",
        "edit-evidence",
        "edit-row",
        "back",
        "save",
      ],
      hints:
        "[c]orrect-data, [r]evise-adjustment, [d]efer, edit-evidence, edit-row, [b]ack, [s]ave",
    },
    { values: ["acknowledge", "back", "save"], hints: "acknowledge, [b]ack, [s]ave" },
    { values: ["1", "add", "back", "save"], hints: "1, add, [b]ack, [s]ave" },
  ])("shows only available letters in $values", async ({ values, hints }) => {
    const { prompts, questions } = scripted([values[0] ?? ""]);
    await choice(prompts, "Action", values);
    expect(questions[0]).toBe(`--> Action (${hints}, [h]elp, [a]bandon): `);
    for (const match of hints.matchAll(/\[([a-z])\]([^,]*)/g)) {
      const letter = match[1] ?? "";
      const expected = `${letter}${match[2] ?? ""}`;
      expect(await choice(scripted([letter.toUpperCase()]).prompts, "Action", values)).toBe(
        expected,
      );
    }
  });
});

describe("confirm current text", () => {
  it.each(["c", "C", "confirm", " CONFIRM ", ""])(
    "keeps the current account name for %j",
    async (input) => {
      const { prompts, questions } = scripted([input]);
      expect(await text(prompts, "Account name", "Demo cash")).toBe("Demo cash");
      expect(questions[0]).toBe(
        "--> Account name: current value is [Demo cash]. [c]onfirm or type new name; or [h]elp, or [a]bandon: ",
      );
    },
  );
  it("shows help before confirming the same current value", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { prompts, questions } = scripted(["h", "c"]);
    expect(await text(prompts, "Account name", "Demo cash")).toBe("Demo cash");
    expect(questions[1]).toBe(questions[0]);
  });
  it.each(["Cash savings", "Confirm savings", "  New Name  "])(
    "accepts a replacement name %j",
    async (input) => {
      expect(await text(scripted([input]).prompts, "Account name", "Demo cash")).toBe(input.trim());
    },
  );
  it("keeps c as data when no current name exists", async () => {
    expect(await text(scripted(["c"]).prompts, "Account name")).toBe("c");
  });
  it("offers confirm for an existing payee without calling it a name", async () => {
    const { prompts, questions } = scripted(["c"]);
    expect(await text(prompts, "Payee", "Demo Shop", "payee")).toBe("Demo Shop");
    expect(questions[0]).toContain("[c]onfirm or type new value");
  });
});

describe("saved choice defaults", () => {
  it.each(["Saved opening", "Saved mapping"])(
    "keeps %s on Enter and displays both shortcuts",
    async (label) => {
      const { prompts, questions } = scripted([""]);
      expect(await keepSaved(prompts, label)).toBe(true);
      expect(questions[0]).toBe(`--> ${label} ([k]eep (default), [e]dit, [h]elp, [a]bandon): `);
    },
  );
  it.each(["k", "K", "keep", " KEEP "])("keeps saved values for %j", async (input) => {
    expect(await keepSaved(scripted([input]).prompts, "Saved opening")).toBe(true);
  });
  it.each(["e", "E", "edit", " EDIT "])("edits saved values for %j", async (input) => {
    expect(await keepSaved(scripted([input]).prompts, "Saved opening")).toBe(false);
  });
  it("repeats after help or invalid input and retains the default", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { prompts, questions } = scripted(["h", "other", ""]);
    expect(await keepSaved(prompts, "Saved opening", "opening-balance")).toBe(true);
    expect(questions).toHaveLength(3);
    expect(questions[1]).toBe(questions[0]);
    expect(questions[2]).toContain("Invalid choice");
    expect(questions[2]).toContain("[k]eep (default)");
  });
  it("abandons without accepting saved values", async () => {
    await expect(keepSaved(scripted(["A"]).prompts, "Saved opening")).rejects.toBeInstanceOf(
      PromptCancelled,
    );
  });
});

it("defaults to Review only when the menu explicitly supplies that default", async () => {
  const { prompts, questions } = scripted(["h", "other", ""]);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(
    await choice(
      prompts,
      "Review has required issues. Next",
      ["review", "save"],
      "abandon",
      "review",
      "review",
    ),
  ).toBe("review");
  expect(questions[0]).toBe(
    "--> Review has required issues. Next ([r]eview (default), [s]ave, [h]elp, [a]bandon): ",
  );
  expect(questions[1]).toBe(questions[0]);
  expect(questions[2]).toContain("Invalid choice");
});
it("rejects a default outside the menu choices before prompting", async () => {
  const { prompts, questions } = scripted([]);
  await expect(
    choice(prompts, "Next", ["review", "save"], "abandon", "review", "import"),
  ).rejects.toThrow("invalid-default-choice");
  expect(questions).toEqual([]);
});
