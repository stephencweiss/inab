import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  overrideConfig: {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["src/*/lint-fixture.ts", "tests/policy/lint-fixture.test.ts"],
          defaultProject: "tsconfig.json",
        },
      },
    },
  },
});

async function ruleIds(code: string, filePath = "src/application/lint-fixture.ts") {
  const engine = filePath.endsWith(".ts") ? eslint : new ESLint();
  const [result] = await engine.lintText(code, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).map((message) => message.ruleId);
}

const OPTIONAL = "inab/no-optional-property";
const UNKNOWN = "inab/unknown-only-in-parser";
const COMMENT = "inab/only-jsdoc-comments";

describe("installed contract rules", () => {
  it.each(["application", "accounts", "budget"])("requires complete %s records", async (folder) => {
    expect(
      await ruleIds("export interface Account { note?: string }", `src/${folder}/lint-fixture.ts`),
    ).toContain(OPTIONAL);
  });

  it("rejects undefined result types", async () => {
    expect(await ruleIds("export type SaveResult = { ok: true } | undefined;")).toContain(
      "inab/no-undefined-type",
    );
  });

  it("allows raw adapter inputs and rejects optional validated outputs", async () => {
    expect(
      await ruleIds(
        "export interface RawCsvInput { note?: string }",
        "src/adapters/lint-fixture.ts",
      ),
    ).not.toContain(OPTIONAL);
    expect(
      await ruleIds("export interface Account { note?: string }", "src/adapters/lint-fixture.ts"),
    ).toContain(OPTIONAL);
  });

  it("keeps nested validated records complete within raw inputs", async () => {
    expect(
      await ruleIds(
        "export interface RawCsvInput { validate(): { note?: string } }",
        "src/adapters/lint-fixture.ts",
      ),
    ).toContain(OPTIONAL);
  });

  it("rejects unknown inputs to budget operations", async () => {
    expect(
      await ruleIds(
        "export function assign(input: unknown) { return input; }",
        "src/budget/lint-fixture.ts",
      ),
    ).toContain(UNKNOWN);
  });

  it("rejects unknown nested in an operation input type", async () => {
    expect(
      await ruleIds(
        "export function assign(input: unknown[]) { return input.length; }",
        "src/budget/lint-fixture.ts",
      ),
    ).toContain(UNKNOWN);
  });

  it("rejects unknown rest inputs to budget operations", async () => {
    expect(
      await ruleIds(
        "export function assign(...items: unknown[]) { return items.length; }",
        "src/budget/lint-fixture.ts",
      ),
    ).toContain(UNKNOWN);
  });

  it("allows typed rest inputs and parser rest inputs", async () => {
    expect(
      await ruleIds("export function assign(...items: number[]) { return items.length; }"),
    ).not.toContain(UNKNOWN);
    expect(
      await ruleIds("export function parseItems(...items: unknown[]) { return items.length; }"),
    ).not.toContain(UNKNOWN);
  });

  it("keeps unrelated guard parameters typed", async () => {
    expect(
      await ruleIds(
        'export function isText(value: unknown, context: unknown): value is string { return typeof value === "string" && context !== null; }',
      ),
    ).toContain(UNKNOWN);
  });

  it("allows parsers, row validators, and guards", async () => {
    expect(
      await ruleIds(`export function parseCsv(input: unknown) { return String(input); }
      export function validateRow(input: Record<string, unknown>) { return typeof input.name === "string"; }
      export function isText(value: unknown): value is string { return typeof value === "string"; }`),
    ).not.toContain(UNKNOWN);
  });

  it("allows an SDK contract at the adapter boundary", async () => {
    expect(
      await ruleIds(
        'import type { SpawnOptions } from "node:child_process"; export type SdkOptions = SpawnOptions;',
        "src/adapters/lint-fixture.ts",
      ),
    ).not.toContain(OPTIONAL);
  });

  it("allows complete records and tagged unions", async () => {
    expect(
      await ruleIds(
        "export type Result = { ok: true; value: string; reason?: never } | { ok: false; reason: string; value?: never };",
      ),
    ).not.toContain(OPTIONAL);
  });
});

describe("installed inference and comment rules", () => {
  it("rejects repeated inferred expression types", async () => {
    expect(
      await ruleIds("declare function read(): string; export const name: string = read();"),
    ).toContain("inab/no-redundant-type");
  });

  it("retains the standard assertion and literal annotation rules", async () => {
    expect(
      await ruleIds("declare function read(): string; export const name = read() as string;"),
    ).toContain("@typescript-eslint/no-unnecessary-type-assertion");
    expect(await ruleIds("export const count: number = 1;")).toContain(
      "@typescript-eslint/no-inferrable-types",
    );
  });

  it.each(["// explanation", "/* explanation */", "// approved:"])(
    "rejects source comment %s",
    async (comment) => {
      expect(await ruleIds(`${comment}\nexport const count = 1;`)).toContain(COMMENT);
    },
  );

  it.each(["/** A storage constraint. */", "// approved: required directive"])(
    "allows source comment %s",
    async (comment) => {
      expect(await ruleIds(`${comment}\nexport const count = 1;`)).not.toContain(COMMENT);
    },
  );

  it("allows test comments through the installed configuration", async () => {
    expect(
      await ruleIds(
        "// Explain the fixture.\nexport const count = 1;",
        "tests/policy/lint-fixture.test.ts",
      ),
    ).not.toContain(COMMENT);
  });

  it("allows tools and config modules but rejects JavaScript application source", async () => {
    expect(await ruleIds("export const count = 1;", "src/application/lint-fixture.mjs")).toContain(
      "typescript-only/typescript-source-only",
    );
    expect(await ruleIds("module.exports = {};", "tools/lint-fixture.cjs")).not.toContain(
      "typescript-only/typescript-source-only",
    );
    expect(await ruleIds("export default {};", "lint-fixture.config.mjs")).not.toContain(
      "typescript-only/typescript-source-only",
    );
  });
});
