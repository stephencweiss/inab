import { describe, expect, it } from "vitest";
import {
  parseYnabAmount,
  parseYnabDate,
  parseYnabMonth,
  parseRegisterRecord,
  parsePlanRecord,
} from "../../src/adapters/ynab/values.js";
import { registerFields, registerHeaders, planFields, planHeaders } from "../helpers/ynab.js";

describe("YNAB source values", () => {
  it.each([
    ["$1,234.56", 123456],
    ["-$12.34", -1234],
    ["$0.00", 0],
    ["12.3", 1230],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", Number.MIN_SAFE_INTEGER],
  ])("parses %s exactly", (text, value) => {
    expect(parseYnabAmount(text)).toEqual({ ok: true, value });
  });
  it.each([
    "$1,23.45",
    "$12,34,567.89",
    "€12.00",
    "1.234",
    "+12",
    "$-12.00",
    "1e2",
    "(12.34)",
    " 12.00",
    "12.00 ",
    "",
    "90071992547409.92",
  ])("rejects %s", (text) => {
    expect(parseYnabAmount(text).ok).toBe(false);
  });
  it.each([
    ["10/22/2026", "2026-10-22"],
    ["02/29/2024", "2024-02-29"],
    ["01/02/2026", "2026-01-02"],
  ])("converts explicit US date %s", (text, value) => {
    expect(parseYnabDate(text)).toEqual({ ok: true, value });
  });
  it.each(["02/29/2026", "02/30/2026", "13/01/2026", "2026-10-22", "1/2/2026", "01/01/0000"])(
    "rejects date %s",
    (text) => {
      expect(parseYnabDate(text).ok).toBe(false);
    },
  );
  it("uses English month labels without date guessing", () => {
    expect(parseYnabMonth("Oct 2026")).toEqual({ ok: true, value: "2026-10" });
    for (const text of ["Okt 2026", "October 2026", "Oct 0000", "2026-10"])
      expect(parseYnabMonth(text).ok).toBe(false);
  });
  it("preserves blanks, flags, source status and zero without posting evidence", () => {
    const fields = registerFields();
    fields[3] = "";
    fields[4] = "";
    fields[5] = "";
    fields[6] = "";
    fields[8] = "$0.00";
    fields[1] = "Purple";
    const result = parseRegisterRecord({ ordinal: 2, fields, raw: "original" }, registerHeaders);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toMatchObject({
        ordinal: 2,
        payee: "",
        category: "",
        categoryGroup: "",
        flag: "Purple",
        sourceStatus: "Cleared",
        postedOn: null,
        cents: 0,
      });
  });
  it.each([
    [8, "-$1.00"],
    [9, "$1.00"],
    [10, "Unknown"],
    [2, "02/30/2026"],
  ])("reports only source location for invalid %s", (index, value) => {
    const fields = registerFields();
    fields[index] = value;
    const result = parseRegisterRecord({ ordinal: 7, fields, raw: "private" }, registerHeaders);
    expect(result).toMatchObject({ ok: false, ordinal: 7, column: registerHeaders[index] });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("normalizes reordered register and plan values", () => {
    const fields = registerFields();
    expect(
      parseRegisterRecord(
        { ordinal: 1, fields: [...fields].reverse(), raw: "" },
        [...registerHeaders].reverse(),
      ),
    ).toEqual(parseRegisterRecord({ ordinal: 1, fields, raw: "" }, registerHeaders));
    const result = parsePlanRecord({ ordinal: 3, fields: planFields(), raw: "" }, planHeaders);
    expect(result).toMatchObject({
      ok: true,
      value: {
        ordinal: 3,
        month: "2026-10",
        assignedCents: 10000,
        activityCents: -1234,
        availableCents: 8766,
      },
    });
  });
});
