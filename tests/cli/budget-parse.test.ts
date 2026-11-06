import { describe, expect, it } from "vitest";
import { parseBudgetArguments, isBudgetArguments } from "../../src/cli/budget-parse.js";
describe("budget terminal parsing", () => {
  it("routes explicit budget commands and retains signed split lines", () => {
    expect(isBudgetArguments(["--db", "x", "budget", "status"])).toBe(true);
    const value = parseBudgetArguments([
      "--db",
      "x",
      "budget",
      "allocate",
      "t",
      "--line",
      "c:-12.00",
      "--line",
      "d:2.00",
      "--expected-version",
      "2",
      "--expected-transaction-version",
      "1",
      "--confirm",
      "--json",
    ]);
    expect(value.action).toBe("allocate");
    expect(value.lines).toEqual(["c:-12.00", "d:2.00"]);
  });
  it("rejects unknown, duplicate and irrelevant flags", () => {
    for (const tail of [["--bogus"], ["--month", "2026-10", "--month", "2026-11"], ["--confirm"]])
      expect(() => parseBudgetArguments(["--db", "x", "budget", "show", ...tail])).toThrow();
  });
  it("rejects interactive JSON and absent database", () => {
    expect(() => parseBudgetArguments(["budget", "status"])).toThrow();
    expect(() =>
      parseBudgetArguments([
        "--db",
        "x",
        "budget",
        "activation",
        "review",
        "--json",
        "--interactive",
      ]),
    ).toThrow();
  });
});
