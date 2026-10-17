import { createRequire } from "node:module";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const parser = require("@typescript-eslint/parser");
const rules = require("../../tools/eslint-plugin-explicit-interfaces/rules.cjs");

const linter = new Linter({ configType: "flat" });

function lint(code: string, filename = "src/application/account.ts") {
  return linter.verify(
    code,
    [
      {
        files: ["**/*.ts"],
        plugins: {
          "explicit-interfaces": { rules },
        },
        languageOptions: {
          parser,
          ecmaVersion: "latest",
          sourceType: "module",
        },
        rules: {
          "explicit-interfaces/no-optional-property": "error",
          "explicit-interfaces/no-undefined-type": "error",
          "explicit-interfaces/unknown-only-in-parser": "error",
        },
      },
    ],
    filename,
  );
}

function ruleIds(code: string, filename?: string) {
  return lint(code, filename).map((message) => message.ruleId);
}

describe("no-optional-property", () => {
  it("allows a property that is present and null", () => {
    expect(ruleIds("export interface Account {\n  name: string | null;\n}")).toEqual([]);
  });

  it("reports an optional property", () => {
    const messages = lint("export interface Account {\n  name?: string;\n}");
    expect(messages.map((message) => message.ruleId)).toEqual([
      "explicit-interfaces/no-optional-property",
    ]);
    expect(messages[0]?.message).toContain("name");
    expect(messages[0]?.message).toContain("null");
  });

  it("reports an optional parameter", () => {
    expect(ruleIds("export function save(name?: string): void {}")).toEqual([
      "explicit-interfaces/no-optional-property",
    ]);
  });

  it("allows optional chaining", () => {
    expect(ruleIds("export const name = input?.name;\n")).toEqual([]);
  });

  it("allows an optional never property in a tagged union", () => {
    expect(
      ruleIds(`export type Entry =
        | { kind: "open"; note: string; closed?: never }
        | { kind: "closed"; closed: string; note?: never };`),
    ).toEqual([]);
  });

  it("allows an optional field on a raw adapter input", () => {
    expect(
      ruleIds("export interface RawCsvInput {\n  date?: string;\n}", "src/adapters/csv.ts"),
    ).toEqual([]);
  });

  it("reports an optional field on a raw type outside adapters", () => {
    expect(ruleIds("export interface RawCsvInput {\n  date?: string;\n}")).toEqual([
      "explicit-interfaces/no-optional-property",
    ]);
  });

  it("reports an optional field on a validated adapter type", () => {
    expect(
      ruleIds("export interface ValidatedRow {\n  date?: string;\n}", "src/adapters/csv.ts"),
    ).toEqual(["explicit-interfaces/no-optional-property"]);
  });
});

describe("no-undefined-type", () => {
  it("allows null for a missing value", () => {
    expect(
      ruleIds("export function read(name: string | null): string | null { return name; }"),
    ).toEqual([]);
  });

  it("reports undefined in a type", () => {
    const messages = lint(
      "export function read(name: string | undefined): string | undefined { return name; }",
    );
    expect(messages.map((message) => message.ruleId)).toEqual([
      "explicit-interfaces/no-undefined-type",
      "explicit-interfaces/no-undefined-type",
    ]);
    expect(messages[0]?.message).toContain("null");
  });

  it("allows the undefined value outside a type", () => {
    expect(ruleIds("export const name = missing ? id : undefined;\n")).toEqual([]);
  });
});

describe("unknown-only-in-parser", () => {
  it("allows unknown on a parser and passes a validated value onward", () => {
    expect(
      ruleIds(`export function parseCsv(rawInput: unknown): { ok: true } | { ok: false } {
        return { ok: false };
      }
      export function save(input: { ok: true } | { ok: false }): void {
        return;
      }`),
    ).toEqual([]);
  });

  it("reports unknown on a domain function", () => {
    const messages = lint("export function save(rawInput: unknown): void { return; }");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("explicit-interfaces/unknown-only-in-parser");
    expect(messages[0]?.message).toContain("unknown");
    expect(messages[0]?.message).toContain("parse");
  });

  it("reports Record<string, unknown> outside a parser", () => {
    expect(ruleIds("export function save(input: Record<string, unknown>): void {}")).toEqual([
      "explicit-interfaces/unknown-only-in-parser",
    ]);
  });

  it("reports unknown in src/lib", () => {
    expect(
      ruleIds(
        "export function requireString(object: Record<string, unknown>, field: string): void {}",
        "src/lib/unknown.ts",
      ),
    ).toEqual(["explicit-interfaces/unknown-only-in-parser"]);
  });

  it("allows a type predicate to accept unknown", () => {
    expect(
      ruleIds(
        "export function isRecord(value: unknown): value is Record<string, unknown> { return true; }",
      ),
    ).toEqual([]);
  });

  it("allows a catch clause to use unknown", () => {
    expect(
      ruleIds(`export function read(): void {
        try {
          read();
        } catch (err: unknown) {
          return;
        }
      }`),
    ).toEqual([]);
  });
});
