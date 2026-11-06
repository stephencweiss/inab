import { describe, it, expect } from "vitest";
import { parseBudgetArguments } from "../../src/cli/budget-parse.js";
import { budgetWriteCommand } from "../../src/cli/budget-commands.js";
import type { BudgetSnapshot } from "../../src/application/budget-ports.js";
const snapshot: BudgetSnapshot = {
  targetId: "t",
  setupState: "fresh",
  state: null,
  accounts: [],
  transactions: [
    {
      id: "tx",
      accountId: "cash",
      occurredOn: "2026-11-01",
      cents: -1000,
      payee: "Shop",
      memo: "",
      postedOn: null,
      revision: 1,
      createdAt: "now",
      updatedAt: "now",
    },
  ],
  sourceRows: [],
};
function command(args: string[]) {
  return parseBudgetArguments(["--db", "x", "budget", ...args]);
}
describe("budget write commands", () => {
  it("assigns an exact signed total", () => {
    expect(
      budgetWriteCommand(
        command(["assign", "--month", "2026-11", "--category", "c", "--amount", "-12.34"]),
        snapshot,
        "id",
      ),
    ).toEqual({ kind: "assign", month: "2026-11", categoryId: "c", amountCents: -1234 });
  });
  it("uses the transaction signed amount for a single category", () => {
    expect(
      budgetWriteCommand(
        command(["allocate", "tx", "--category", "c", "--expected-transaction-version", "1"]),
        snapshot,
        "id",
      ),
    ).toMatchObject({
      kind: "allocate",
      allocation: { kind: "categories", lines: [{ categoryId: "c", amountCents: -1000 }] },
    });
  });
  it("rejects conflicting allocation choices", () => {
    expect(() =>
      budgetWriteCommand(
        command([
          "allocate",
          "tx",
          "--category",
          "c",
          "--income",
          "--expected-transaction-version",
          "1",
        ]),
        snapshot,
        "id",
      ),
    ).toThrow("allocation-choice-required");
  });
});
