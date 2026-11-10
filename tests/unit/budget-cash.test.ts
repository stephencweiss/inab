import { describe, expect, it } from "vitest";
import { fixture } from "./budget-opening.test.ts";
import { calculateBudget } from "../../src/budget/calculate.ts";
import { validateAllocations } from "../../src/budget/allocations.ts";
import { validateTransfer } from "../../src/budget/transfers.ts";
import type { BudgetTransaction, BudgetFacts } from "../../src/budget/types.ts";
function report(facts: BudgetFacts, month = "2026-10") {
  const result = calculateBudget(facts, month);
  if (!result.ok) throw new Error(result.reason);
  return result.months;
}
function transaction(
  id: string,
  accountId: string,
  amountCents: number,
  date = "2026-10-15",
): BudgetTransaction {
  return {
    kind: "transaction",
    id,
    sourceId: id,
    date,
    order: 0,
    accountId,
    amountCents,
    allocation: { kind: "categories", lines: [{ categoryId: "food", amountCents }] },
  };
}
function card(facts: BudgetFacts, id = "card", balance = 0, reserve = 0) {
  facts.opening.accounts.push({
    accountId: id,
    kind: "credit",
    balanceCents: balance,
    closed: false,
    evidence: "bank",
  });
  facts.categories.push({
    id: `pay-${id}`,
    groupId: "cards",
    name: id,
    archived: false,
    cardAccountId: id,
  });
  facts.opening.categories.push({
    categoryId: `pay-${id}`,
    availableCents: reserve,
    evidence: "review",
  });
  facts.opening.readyToAssignCents -= Math.max(balance, 0) + reserve;
  facts.opening.readyToAssignCents += 2 * Math.max(balance, 0);
}
describe("monthly envelopes", () => {
  it("carries positive funds and saves each assignment once", () => {
    const f = fixture();
    f.assignments = [
      { month: "2026-10", categoryId: "food", amountCents: 20000 },
      { month: "2026-11", categoryId: "food", amountCents: 5000 },
    ];
    f.events = [transaction("spend", "cash", -6000)];
    const months = report(f, "2026-11");
    expect(months[0]).toMatchObject({
      readyToAssignCents: 70000,
      futureAssignedCents: 5000,
      categories: [{ availableCents: 24000 }],
    });
    expect(months[1]).toMatchObject({
      readyToAssignCents: 65000,
      categories: [{ availableCents: 29000 }],
    });
  });
  it("shows cash overspending and deducts it at rollover", () => {
    const f = fixture();
    f.events = [transaction("spend", "cash", -15000)];
    const months = report(f, "2027-01");
    expect(months[0]?.categories[0]).toMatchObject({
      availableCents: -5000,
      cashOverspentCents: 5000,
    });
    expect(months[1]).toMatchObject({
      readyToAssignCents: 85000,
      categories: [{ carryInCents: 0, availableCents: 0 }],
    });
  });
  it("distinguishes income, refunds and incomplete activity", () => {
    const f = fixture();
    f.events = [
      transaction("refund", "cash", 2000),
      { ...transaction("income", "cash", 3000), allocation: { kind: "income" } },
      { ...transaction("unknown", "cash", -1000), allocation: { kind: "unallocated" } },
    ];
    expect(report(f)[0]).toMatchObject({
      readyToAssignCents: 93000,
      complete: false,
      unallocatedEventIds: ["unknown"],
      categories: [{ availableCents: 12000 }],
    });
  });
  it("checks exact split sums and intermediate overflow", () => {
    expect(
      validateAllocations(-100, [
        { categoryId: "a", amountCents: -40 },
        { categoryId: "b", amountCents: -60 },
      ]).ok,
    ).toBe(true);
    expect(validateAllocations(-100, [{ categoryId: "a", amountCents: -99 }]).ok).toBe(false);
    expect(
      validateAllocations(0, [
        { categoryId: "a", amountCents: Number.MAX_SAFE_INTEGER },
        { categoryId: "b", amountCents: 1 },
        { categoryId: "c", amountCents: -Number.MAX_SAFE_INTEGER },
      ]).ok,
    ).toBe(false);
  });
  it("reports future commitments once", () => {
    const f = fixture();
    f.assignments = [{ month: "2027-01", categoryId: "food", amountCents: 95000 }];
    expect(report(f)[0]).toMatchObject({ futureAssignedCents: 95000, fundingDeficitCents: 5000 });
  });
});
describe("card funding", () => {
  it("reserves only the debt part across a positive card balance", () => {
    const f = fixture();
    card(f, "card", 5000);
    f.events = [transaction("purchase", "card", -7000)];
    expect(report(f)[0]).toMatchObject({
      cards: [{ balanceCents: -2000, reserveCents: 2000, shortfallCents: 0 }],
      categories: [{ availableCents: 3000 }, { availableCents: 2000 }],
      heldFundsCents: 100000,
    });
  });
  it("funds cash first then cards in stable account ID order", () => {
    const f = fixture();
    card(f, "b");
    card(f, "a");
    f.events = [
      transaction("b", "b", -8000),
      transaction("a", "a", -8000),
      transaction("cash", "cash", -3000),
    ];
    const a = report(f)[0];
    f.events.reverse();
    expect(report(f)[0]).toEqual(a);
    expect(a?.cards).toEqual([
      { accountId: "a", balanceCents: -8000, reserveCents: 7000, shortfallCents: 1000 },
      { accountId: "b", balanceCents: -8000, reserveCents: 0, shortfallCents: 8000 },
    ]);
    expect(a?.categories[0]).toMatchObject({ cashOverspentCents: 0, creditOverspentCents: 9000 });
  });
  it("recalculates reserve when the same month receives funding", () => {
    const f = fixture();
    card(f);
    f.events = [transaction("buy", "card", -15000)];
    expect(report(f)[0]?.cards[0]?.reserveCents).toBe(10000);
    f.assignments = [{ month: "2026-10", categoryId: "food", amountCents: 5000 }];
    expect(report(f)[0]?.cards[0]?.reserveCents).toBe(15000);
  });
  it("keeps a visible reserve deficit after a paid purchase is refunded", () => {
    const f = fixture();
    card(f);
    f.events = [
      transaction("buy", "card", -6000, "2026-10-01"),
      {
        kind: "transfer",
        id: "pay",
        sourceId: "pay",
        date: "2026-10-02",
        order: 0,
        fromAccountId: "cash",
        toAccountId: "card",
        amountCents: 6000,
        categoryId: null,
      },
      transaction("refund", "card", 6000, "2026-11-01"),
    ];
    const last = report(f, "2026-11")[1];
    expect(last).toMatchObject({
      readyToAssignCents: 96000,
      cards: [{ balanceCents: 6000, reserveCents: -6000 }],
      categories: [{ availableCents: 10000 }, { availableCents: -6000 }],
    });
  });
  it("does not invent income from a debt-reducing statement credit", () => {
    const f = fixture();
    card(f, "card", -10000);
    f.events = [{ ...transaction("credit", "card", 3000), allocation: { kind: "income" } }];
    expect(report(f)[0]).toMatchObject({
      readyToAssignCents: 90000,
      cards: [{ balanceCents: -7000, reserveCents: 0 }],
    });
  });
  it("separates overpayment held funds from reserve consumption", () => {
    const f = fixture();
    f.opening.accounts[0]!.balanceCents = 10000;
    f.opening.categories[0]!.availableCents = 0;
    f.opening.readyToAssignCents = 3000;
    card(f, "card", -5000, 7000);
    f.opening.readyToAssignCents = 3000;
    f.events = [
      {
        kind: "transfer",
        id: "pay",
        sourceId: "pay",
        date: "2026-10-01",
        order: 0,
        fromAccountId: "cash",
        toAccountId: "card",
        amountCents: 7000,
        categoryId: null,
      },
    ];
    expect(report(f)[0]).toMatchObject({
      readyToAssignCents: 5000,
      heldFundsCents: 5000,
      cards: [{ balanceCents: 2000, reserveCents: 0 }],
    });
  });
});
describe("transfers", () => {
  it("rejects unsupported directions and self transfers", () => {
    const f = fixture();
    card(f);
    const base = {
      kind: "transfer" as const,
      id: "t",
      sourceId: "t",
      date: "2026-10-01",
      order: 0,
      fromAccountId: "card",
      toAccountId: "cash",
      amountCents: 100,
      categoryId: null,
    };
    expect(validateTransfer(base, f).ok).toBe(false);
    expect(validateTransfer({ ...base, fromAccountId: "cash" }, f).ok).toBe(false);
  });
  it("changes no envelope on cash-to-cash movement", () => {
    const f = fixture();
    f.opening.accounts.push({
      accountId: "other",
      kind: "cash",
      balanceCents: 0,
      closed: false,
      evidence: "bank",
    });
    f.events = [
      {
        kind: "transfer",
        id: "t",
        sourceId: "t",
        date: "2026-10-01",
        order: 0,
        fromAccountId: "cash",
        toAccountId: "other",
        amountCents: 10000,
        categoryId: null,
      },
    ];
    expect(report(f)[0]).toMatchObject({
      readyToAssignCents: 90000,
      heldFundsCents: 100000,
      categories: [{ availableCents: 10000 }],
    });
  });
});
it("uses a category refund to fund another card in the same month", () => {
  const f = fixture();
  f.opening.categories[0]!.availableCents = 0;
  f.opening.readyToAssignCents = 100000;
  card(f, "a", -10000);
  card(f, "b");
  f.events = [transaction("refund", "a", 2000), transaction("buy", "b", -2000)];
  const month = report(f)[0];
  expect(month?.categories[0]).toMatchObject({ availableCents: 0, creditOverspentCents: 0 });
  expect(month?.cards).toMatchObject([{ reserveCents: -2000 }, { reserveCents: 2000 }]);
});
it("prioritizes category refunds before cash and credit funding", () => {
  const f = fixture();
  f.opening.categories[0]!.availableCents = 0;
  f.opening.readyToAssignCents = 100000;
  card(f, "a", -10000);
  f.events = [transaction("refund", "a", 2000), transaction("cash", "cash", -3000)];
  expect(report(f)[0]?.categories[0]).toMatchObject({
    availableCents: -1000,
    cashOverspentCents: 1000,
    creditOverspentCents: 0,
  });
});
it("does not reverse a reserve for refunded positive-card funds", () => {
  const f = fixture();
  card(f, "card", 5000);
  f.events = [
    transaction("buy", "card", -7000, "2026-10-01"),
    transaction("refund", "card", 7000, "2026-11-01"),
  ];
  const month = report(f, "2026-11")[1];
  expect(month).toMatchObject({
    readyToAssignCents: 95000,
    cards: [{ balanceCents: 5000, reserveCents: 0 }],
    categories: [{ availableCents: 10000 }, { availableCents: 0 }],
  });
});
it("shows a future deficit before a later assignment return", () => {
  const f = fixture();
  f.opening.readyToAssignCents = 10000;
  f.opening.categories[0]!.availableCents = 0;
  f.opening.accounts[0]!.balanceCents = 10000;
  f.assignments = [
    { month: "2026-11", categoryId: "food", amountCents: 20000 },
    { month: "2026-12", categoryId: "food", amountCents: -10000 },
  ];
  const months = report(f, "2026-12");
  expect(months[0]).toMatchObject({ futureAssignedCents: 20000, fundingDeficitCents: 10000 });
  expect(months[1]).toMatchObject({
    readyToAssignCents: -10000,
    futureAssignedCents: 0,
    fundingDeficitCents: 10000,
  });
  expect(months[2]).toMatchObject({ readyToAssignCents: 0, fundingDeficitCents: 0 });
  f.assignments.reverse();
  expect(report(f, "2026-12")).toEqual(months);
});
it("uses gross split spending across positive card funds and holds the net refund funds", () => {
  const f = fixture();
  card(f, "card", 5000);
  f.categories.push({
    id: "zrefund",
    groupId: "living",
    name: "Refund",
    archived: false,
    cardAccountId: null,
  });
  f.opening.categories.push({ categoryId: "zrefund", availableCents: 0, evidence: "review" });
  f.events = [
    {
      kind: "transaction",
      id: "split",
      sourceId: "split",
      date: "2026-10-01",
      order: 0,
      accountId: "card",
      amountCents: -1000,
      allocation: {
        kind: "categories",
        lines: [
          { categoryId: "food", amountCents: -7000 },
          { categoryId: "zrefund", amountCents: 6000 },
        ],
      },
    },
  ];
  const month = report(f)[0];
  expect(month).toMatchObject({
    readyToAssignCents: 99000,
    heldFundsCents: 104000,
    cards: [{ balanceCents: 4000, reserveCents: -4000 }],
    categories: [{ availableCents: 3000 }, { availableCents: -4000 }, { availableCents: 6000 }],
  });
  const event = f.events[0];
  if (event?.kind === "transaction" && event.allocation.kind === "categories")
    event.allocation.lines.reverse();
  expect(report(f)[0]).toEqual(month);
});
