import { describe, expect, it } from "vitest";
import { parseBudgetFacts, parseMonth } from "../../src/budget/parse.ts";
import { validateOpening } from "../../src/budget/opening.ts";
import type { BudgetFacts } from "../../src/budget/types.ts";
export function fixture(): BudgetFacts {
  return {
    startMonth: "2026-10",
    currency: "USD",
    opening: {
      accounts: [
        { accountId: "cash", kind: "cash", balanceCents: 100000, closed: false, evidence: "bank" },
      ],
      categories: [{ categoryId: "food", availableCents: 10000, evidence: "review" }],
      readyToAssignCents: 90000,
      evidence: "review",
      deficitAcknowledged: false,
    },
    categories: [
      { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
    ],
    assignments: [],
    events: [],
  };
}
describe("validated budget facts", () => {
  it("accepts the exact opening equation", () =>
    expect(validateOpening(fixture())).toEqual({
      ok: true,
      heldFundsCents: 100000,
      allocatedCents: 100000,
      differenceCents: 0,
    }));
  it("returns an exact unexplained difference", () => {
    const facts = fixture();
    facts.opening.readyToAssignCents = 80000;
    expect(validateOpening(facts)).toMatchObject({
      ok: false,
      reason: "opening-difference",
      differenceCents: 10000,
    });
  });
  it("parses complete facts and rejects absent zero, unsafe cents, currency and evidence", () => {
    expect(parseBudgetFacts(fixture()).ok).toBe(true);
    for (const bad of [
      { ...fixture(), currency: "EUR" },
      { ...fixture(), opening: { ...fixture().opening, readyToAssignCents: null } },
      {
        ...fixture(),
        opening: { ...fixture().opening, readyToAssignCents: Number.MAX_SAFE_INTEGER + 1 },
      },
      { ...fixture(), opening: { ...fixture().opening, evidence: "" } },
    ])
      expect(parseBudgetFacts(bad).ok).toBe(false);
  });
  it("rejects malformed months and impossible occurrence dates", () => {
    for (const month of ["2026-1", "0000-01", "2026-13", "2026-00"])
      expect(parseMonth(month).ok).toBe(false);
    expect(parseMonth("2024-02")).toEqual({ ok: true, value: "2024-02" });
    const facts = fixture();
    expect(
      parseBudgetFacts({
        ...facts,
        events: [
          {
            kind: "transaction",
            id: "t",
            sourceId: "s",
            date: "2026-02-29",
            order: 0,
            accountId: "cash",
            amountCents: 1,
            allocation: { kind: "income" },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  it("requires every card reserve and unique sources", () => {
    const facts = fixture();
    facts.opening.accounts.push({
      accountId: "card",
      kind: "credit",
      balanceCents: -2000,
      closed: true,
      evidence: "bank",
    });
    expect(validateOpening(facts).ok).toBe(false);
  });
});
it("requires prior ordinary category overspending to be resolved at activation", () => {
  const f = fixture();
  f.opening.categories[0]!.availableCents = -5000;
  f.opening.readyToAssignCents = 105000;
  expect(validateOpening(f)).toMatchObject({
    ok: false,
    reason: "opening-overspending-needs-resolution",
  });
});
it("keeps reviewed negative card reserves visible in the opening", () => {
  const f = fixture();
  f.opening.accounts.push({
    accountId: "card",
    kind: "credit",
    balanceCents: 0,
    closed: false,
    evidence: "bank",
  });
  f.categories.push({
    id: "payment",
    groupId: "cards",
    name: "Card",
    archived: false,
    cardAccountId: "card",
  });
  f.opening.categories.push({
    categoryId: "payment",
    availableCents: -5000,
    evidence: "reviewed-refund",
  });
  f.opening.readyToAssignCents = 95000;
  expect(validateOpening(f)).toMatchObject({ ok: true, differenceCents: 0 });
});
