import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { editBudgetDraft, budgetVimArguments } from "../../src/cli/budget-editor.js";
import { terminalPrompts } from "../../src/cli/prompts.js";
const state = vi.hoisted(() => ({ created: 0, closed: 0, edit: vi.fn() }));
vi.mock("../../src/bootstrap.js", () => ({ budgetDraftEditor: state.edit }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => {
    state.created++;
    return Object.assign(new EventEmitter(), {
      question: async () => String(state.created),
      close: () => {
        state.closed++;
      },
    });
  },
}));
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
afterEach(() => {
  state.created = 0;
  state.closed = 0;
  state.edit.mockReset();
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  if (stderrTTY) Object.defineProperty(process.stderr, "isTTY", stderrTTY);
  else Reflect.deleteProperty(process.stderr, "isTTY");
});
const draft = {
  facts: {
    startMonth: "2026-11",
    currency: "USD" as const,
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
  },
  coverage: {
    throughDate: "2026-11-05",
    evidence: "Synthetic complete",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  },
};
it("releases the active terminal before Vim and creates a new prompt afterward", async () => {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  const prompts = terminalPrompts();
  await expect(prompts.ask("Before editor")).resolves.toBe("1");
  state.edit.mockImplementation(async () => {
    expect(state.closed).toBe(1);
    return { ...draft, coverage: { ...draft.coverage, evidence: "Edited" } };
  });
  expect((await editBudgetDraft(draft, prompts))?.coverage.evidence).toBe("Edited");
  await expect(prompts.ask("After editor")).resolves.toBe("2");
  expect(state.created).toBe(2);
  prompts.close();
});
it("does not open Vim for noninteractive input", async () => {
  await expect(editBudgetDraft(draft, { interactive: false, ask: async () => "" })).rejects.toThrow(
    "interactive-terminal-required",
  );
  expect(state.edit).not.toHaveBeenCalled();
});
it("preserves cancellation and reports a recoverable validation error", async () => {
  const prompts = { interactive: true, ask: async () => "" };
  state.edit.mockResolvedValueOnce(null);
  await expect(editBudgetDraft(draft, prompts)).resolves.toBeNull();
  state.edit.mockRejectedValueOnce(new Error("invalid-budget-editor-json"));
  await expect(editBudgetDraft(draft, prompts)).rejects.toThrow("Saved choices are unchanged");
  expect(draft.coverage.evidence).toBe("Synthetic complete");
});
it("disables Vim persistence and modelines before opening the private file", () => {
  const args = budgetVimArguments("/synthetic/draft.json");
  expect(args).toContain("-n");
  expect(args).toContain("--noplugin");
  expect(args).toEqual(expect.arrayContaining(["-u", "NONE", "-U", "NONE", "-i", "NONE"]));
  expect(args.indexOf("--cmd")).toBeLessThan(args.indexOf("--"));
  expect(args.join(" ")).toContain("nomodeline");
  expect(args.join(" ")).toContain("noundofile");
  expect(args.at(-1)).toBe("/synthetic/draft.json");
});
