import { expect, it } from "vitest";
import { fixture } from "./budget-opening.test.ts";
import { parseBudgetFacts } from "../../src/budget/parse.js";
import { calculateBudget } from "../../src/budget/calculate.js";
it("rejects duplicate effects even with distinct event IDs", () => {
  const f = fixture();
  f.events = [
    {
      kind: "transaction",
      id: "one",
      sourceId: "source",
      date: "2026-10-01",
      order: 0,
      accountId: "cash",
      amountCents: 100,
      allocation: { kind: "income" },
    },
    {
      kind: "transaction",
      id: "two",
      sourceId: "source",
      date: "2026-10-01",
      order: 0,
      accountId: "cash",
      amountCents: 100,
      allocation: { kind: "income" },
    },
  ];
  expect(parseBudgetFacts(f)).toMatchObject({ ok: false, reason: "duplicate-budget-fact" });
});
it("rejects invalid allocation sums at parsing", () => {
  const f = fixture();
  f.events = [
    {
      kind: "transaction",
      id: "one",
      sourceId: "source",
      date: "2026-10-01",
      order: 0,
      accountId: "cash",
      amountCents: -100,
      allocation: { kind: "categories", lines: [{ categoryId: "food", amountCents: -99 }] },
    },
  ];
  expect(parseBudgetFacts(f).ok).toBe(false);
});
it("rejects missing evidence and Tracking opening accounts", () => {
  const f = fixture();
  expect(
    parseBudgetFacts({
      ...f,
      opening: { ...f.opening, accounts: [{ ...f.opening.accounts[0], kind: "tracking" }] },
    }).ok,
  ).toBe(false);
  expect(
    parseBudgetFacts({
      ...f,
      opening: { ...f.opening, accounts: [{ ...f.opening.accounts[0], evidence: null }] },
    }).ok,
  ).toBe(false);
});
it("rejects unsafe intermediates when later values could cancel them", () => {
  const f = fixture();
  f.opening.accounts[0]!.balanceCents = Number.MAX_SAFE_INTEGER;
  f.opening.accounts.push(
    { accountId: "other", kind: "cash", balanceCents: 1, closed: false, evidence: "review" },
    { accountId: "last", kind: "cash", balanceCents: -1, closed: false, evidence: "review" },
  );
  expect(calculateBudget(f, "2026-10")).toMatchObject({ ok: false, reason: "unsafe-cents" });
});
it("rejects a future report before activation and validates leap days", () => {
  const f = fixture();
  expect(calculateBudget(f, "2026-09").ok).toBe(false);
  f.startMonth = "2024-02";
  f.events = [
    {
      kind: "transaction",
      id: "one",
      sourceId: "one",
      date: "2024-02-29",
      order: 0,
      accountId: "cash",
      amountCents: 100,
      allocation: { kind: "income" },
    },
  ];
  expect(parseBudgetFacts(f).ok).toBe(true);
});
