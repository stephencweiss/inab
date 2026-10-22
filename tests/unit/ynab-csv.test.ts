import { describe, expect, it } from "vitest";
import { parseYnabCsv } from "../../src/adapters/ynab/csv.js";
import {
  csvBytes,
  csvText,
  planFields,
  planHeaders,
  registerFields,
  registerHeaders,
} from "../helpers/ynab.js";

describe("bounded YNAB CSV", () => {
  it.each(["\n", "\r\n"])("keeps logical records with %j", (newline) => {
    const row = registerFields();
    row[3] = 'Store, "sample"';
    row[7] = "line one\nline two";
    const text = "\uFEFF" + csvText(registerHeaders, [row, row, Array(11).fill("")], newline);
    const result = parseYnabCsv("register", new TextEncoder().encode(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((item) => item.ordinal)).toEqual([1, 2, 3]);
    expect(result.value.rows[0]?.fields).toEqual(row);
    expect(result.value.rows[0]?.raw).toContain('"line one\nline two"');
    expect(result.value.rows[2]?.fields).toEqual(Array(11).fill(""));
  });
  it("accepts plan data, reordered headers, and truly empty lines", () => {
    const result = parseYnabCsv(
      "plan",
      new TextEncoder().encode(
        "\n" + csvText([...planHeaders].reverse(), [[...planFields()].reverse()]) + "\n",
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows).toHaveLength(1);
  });
  it.each(
    [
      registerHeaders.slice(1),
      [...registerHeaders, "Other"],
      registerHeaders.map((name, index) => (index === 1 ? "Account" : name)),
    ].map((headers) => ({ headers })),
  )("rejects unsupported header %j", ({ headers }) => {
    expect(parseYnabCsv("register", csvBytes(headers, []))).toEqual({
      ok: false,
      reason: "unsupported-header",
    });
  });
  it.each(['"broken', csvText(registerHeaders, [registerFields().slice(1)]), "   \n"])(
    "rejects malformed CSV",
    (text) => {
      expect(parseYnabCsv("register", new TextEncoder().encode(text)).ok).toBe(false);
    },
  );
  it("rejects invalid UTF-8 and empty inputs", () => {
    expect(parseYnabCsv("plan", new Uint8Array([0xff]))).toEqual({
      ok: false,
      reason: "invalid-csv",
    });
    expect(parseYnabCsv("plan", new Uint8Array()).ok).toBe(false);
  });
  it("bounds file bytes, record size, and data count", () => {
    expect(parseYnabCsv("register", new Uint8Array(64 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      reason: "input-limit",
    });
    const row = registerFields();
    row[7] = "x".repeat(1024 * 1024 + 1);
    expect(parseYnabCsv("register", csvBytes(registerHeaders, [row]))).toEqual({
      ok: false,
      reason: "input-limit",
    });
    const text = csvText(planHeaders, []) + "a,b,c,d,0,0,0\n".repeat(250001);
    expect(parseYnabCsv("plan", new TextEncoder().encode(text))).toEqual({
      ok: false,
      reason: "input-limit",
    });
  });
});
