import { describe, expect, it } from "vitest";
import { checkedSum, parseMoney, validateCents } from "../../src/lib/money.js";

describe("exact USD amounts", () => {
  it.each([
    ["12.34", 1234],
    ["-0.01", -1],
    ["0", 0],
    ["-0.00", 0],
    ["12.3", 1230],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", Number.MIN_SAFE_INTEGER],
  ])("parses %s as exact cents", (text, cents) => {
    expect(parseMoney(text)).toEqual({ ok: true, value: cents });
  });

  it.each([
    "1.234",
    "1e2",
    "NaN",
    "Infinity",
    "",
    " 1",
    "1 ",
    ".5",
    "1.",
    "1/2",
    "+1",
    12.34,
    null,
  ])("rejects invalid input %s", (input) => {
    expect(parseMoney(input)).toEqual({ ok: false, reason: "invalid-money" });
  });

  it.each(["90071992547409.92", "-90071992547409.92", "999999999999999999999999999999999"])(
    "rejects overflow %s",
    (text) => {
      expect(parseMoney(text)).toEqual({ ok: false, reason: "unsafe-cents" });
    },
  );

  it("allows zero balances but rejects zero transactions", () => {
    expect(validateCents(0, "opening")).toEqual({ ok: true, value: 0 });
    expect(validateCents(0, "snapshot")).toEqual({ ok: true, value: 0 });
    expect(validateCents(0, "transaction")).toEqual({ ok: false, reason: "zero-transaction" });
  });

  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid cents %s",
    (cents) => {
      expect(validateCents(cents, "opening")).toEqual({ ok: false, reason: "unsafe-cents" });
      expect(checkedSum([cents])).toEqual({ ok: false, reason: "unsafe-cents" });
    },
  );

  it("checks each intermediate sum before a later cancellation", () => {
    expect(checkedSum([Number.MAX_SAFE_INTEGER, 1, -1])).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    expect(checkedSum([Number.MIN_SAFE_INTEGER, -1, 1])).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    expect(checkedSum([100000, -6000, -2500])).toEqual({ ok: true, value: 91500 });
    expect(checkedSum([])).toEqual({ ok: true, value: 0 });
  });
});
