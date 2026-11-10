import { expect, it } from "vitest";
import { renderBudgetReport } from "../../src/cli/budget-render.js";
const report = {
  revision: 3,
  status: "active",
  startMonth: "2026-10",
  categories: [
    { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
  ],
  month: {
    month: "2026-11",
    readyToAssignCents: 1234,
    futureAssignedCents: 200,
    fundingDeficitCents: 0,
    heldFundsCents: 2000,
    complete: false,
    unallocatedEventIds: ["tx"],
    categories: [
      {
        categoryId: "food",
        carryInCents: 100,
        assignedCents: 200,
        activityCents: -301,
        availableCents: -1,
        cashOverspentCents: 1,
        creditOverspentCents: 0,
      },
    ],
    cards: [{ accountId: "card", balanceCents: -1000, reserveCents: 900, shortfallCents: 100 }],
  },
} satisfies Parameters<typeof renderBudgetReport>[0];
it("shows exact USD cents, category totals and card reserve warnings", () => {
  const text = renderBudgetReport(report);
  expect(text).toContain("Ready to Assign: USD 12.34");
  expect(text).toContain("Food");
  expect(text).toContain("-0.01");
  expect(text).toContain("Shortfall");
  expect(text).toMatch(/card\s+\|\s+-10\.00\s+\|\s+9\.00\s+\|\s+1\.00/);
  expect(text).toContain("Unallocated: tx");
  expect(text).toMatch(/Carry-in\s+\|\s+Assigned\s+\|\s+Activity\s+\|\s+Available/);
});

it("aligns category columns and preserves full category and card IDs", () => {
  const firstId = "category:acf3aa9e-f265-4a80-92b4-4fa0114d94ea:1";
  const secondId = "category:acf3aa9e-f265-4a80-92b4-4fa0114d94ea:2";
  const [category] = report.categories;
  const [totals] = report.month.categories;
  const [card] = report.month.cards;
  if (!category || !totals || !card) throw new Error("Incomplete report fixture");
  const fixture = {
    ...report,
    categories: [
      { ...category, id: firstId, name: "Food" },
      { ...category, id: secondId, name: "Card payment" },
    ],
    month: {
      ...report.month,
      categories: [
        { ...totals, categoryId: firstId },
        { ...totals, categoryId: secondId, availableCents: 1234567 },
      ],
      cards: [{ ...card, accountId: "f42222a6-52e7-4dee-a215-0802b23d35b2" }],
    },
  };
  const original = structuredClone(fixture);
  const text = renderBudgetReport(fixture);
  expect(text).toContain(firstId);
  expect(text).toContain(secondId);
  expect(text).toContain("f42222a6-52e7-4dee-a215-0802b23d35b2");
  expect(text).not.toContain("last 4 characters");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Category"));
  const table = [lines[start], lines[start + 2], lines[start + 3]];
  const columns = (line: string) => [...line.matchAll(/\|/g)].map((match) => match.index);
  expect(table.every((line) => line !== undefined)).toBe(true);
  for (const row of table) expect(columns(row ?? "")).toEqual(columns(table[0] ?? ""));
  expect(lines[start + 1]).toMatch(/^-+(\+-+)+$/);
  expect(text).toContain("12345.67");
  expect(fixture).toEqual(original);
});
