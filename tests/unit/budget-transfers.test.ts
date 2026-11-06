import { expect, it } from "vitest";
import { fixture } from "./budget-opening.test.ts";
import { calculateBudget } from "../../src/budget/calculate.js";
import { validateTransfer } from "../../src/budget/transfers.js";
import type { BudgetTransfer } from "../../src/budget/types.js";
const transfer: BudgetTransfer = {
  kind: "transfer",
  id: "transfer",
  sourceId: "transfer",
  date: "2026-10-01",
  order: 0,
  fromAccountId: "cash",
  toAccountId: "tracking",
  amountCents: 6000,
  categoryId: "food",
};
it("counts an explicit Tracking boundary outflow once", () => {
  const f = fixture();
  f.events = [transfer];
  const r = calculateBudget(f, "2026-10");
  expect(r).toMatchObject({
    ok: true,
    months: [
      { heldFundsCents: 94000, readyToAssignCents: 90000, categories: [{ availableCents: 4000 }] },
    ],
  });
});
it("distinguishes explicit Tracking income and category refunds", () => {
  const f = fixture();
  f.events = [{ ...transfer, fromAccountId: "tracking", toAccountId: "cash", categoryId: null }];
  expect(calculateBudget(f, "2026-10")).toMatchObject({
    ok: true,
    months: [
      {
        heldFundsCents: 106000,
        readyToAssignCents: 96000,
        categories: [{ availableCents: 10000 }],
      },
    ],
  });
  f.events = [{ ...transfer, fromAccountId: "tracking", toAccountId: "cash", categoryId: "food" }];
  expect(calculateBudget(f, "2026-10")).toMatchObject({
    ok: true,
    months: [{ readyToAssignCents: 90000, categories: [{ availableCents: 16000 }] }],
  });
});
it("refuses unclassified outflows and unsupported external to external transfers", () => {
  const f = fixture();
  expect(validateTransfer({ ...transfer, categoryId: null }, f).ok).toBe(false);
  expect(validateTransfer({ ...transfer, fromAccountId: "external" }, f).ok).toBe(false);
});
it("rejects nonconserving split sources before calculating totals", () => {
  const f = fixture();
  f.events = [transfer, { ...transfer, id: "duplicate" }];
  expect(calculateBudget(f, "2026-10")).toMatchObject({
    ok: false,
    reason: "duplicate-budget-fact",
  });
});
