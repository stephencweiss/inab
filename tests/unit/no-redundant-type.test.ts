import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const parser = require("@typescript-eslint/parser");
const rules = require("../../tools/eslint-plugin-inab/type-inference.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const linter = new Linter({ configType: "flat" });

function lint(code: string) {
  return linter.verify(
    code,
    [
      {
        files: ["**/*.ts"],
        plugins: {
          "type-inference": { rules },
        },
        languageOptions: {
          parser,
          parserOptions: {
            projectService: {
              allowDefaultProject: ["src/lint-fixture.ts"],
              defaultProject: "tsconfig.json",
            },
            tsconfigRootDir: root,
          },
        },
        rules: {
          "type-inference/no-redundant-type": "error",
        },
      },
    ],
    path.join(root, "src/lint-fixture.ts"),
  );
}

function reports(code: string) {
  const messages = lint(code);
  const fatal = messages.filter((message) => message.fatal);
  expect(fatal).toEqual([]);
  return messages.filter((message) => message.ruleId === "type-inference/no-redundant-type");
}

describe("no-redundant-type", () => {
  it("reports an annotation that copies the inferred key union", () => {
    const messages = reports(`type Example = { foo: string | null; bar: string | null };
      declare function entriesOf<T extends object>(value: T): [keyof T & string, T[keyof T]][];
      declare const example: Example;
      const present = entriesOf(example).filter((entry) => entry[1] !== null);
      const keys: ("foo" | "bar")[] = present.map(([key]) => key);`);

    expect(messages.map((message) => message.message)).toEqual([
      "This annotation copies the type of the value. Remove it so the type can follow the value.",
    ]);
  });

  it("reports an annotation that repeats the expression type", () => {
    const messages = reports(`declare function getName(): string;
      const name: string = getName();`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("copies the type of the value");
  });

  it("reports a type predicate on a callback", () => {
    const messages = reports(`type Example = { foo: string | null; bar: string | null };
      declare function entriesOf<T extends object>(value: T): [keyof T & string, T[keyof T]][];
      declare const example: Example;
      entriesOf(example).filter(
        (entry): entry is ["foo" | "bar", string] => entry[1] !== null,
      );`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("type predicate");
  });

  it("reports a callback parameter type that the callee already provides", () => {
    const messages = reports(`declare function mapKeys(
        items: ("foo" | "bar")[],
        read: (key: "foo" | "bar") => "foo" | "bar",
      ): ("foo" | "bar")[];
      mapKeys(["foo"], (key: "foo" | "bar") => key);`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("callback parameter");
  });

  it("allows an empty list to keep its element type", () => {
    expect(reports("const items: string[] = [];")).toEqual([]);
  });

  it("allows an annotation that widens a literal", () => {
    expect(reports('const status: "open" | "closed" = "open";')).toEqual([]);
  });

  it("allows a parameter type on a function", () => {
    expect(reports("export function read(name: string): string {\n  return name;\n}")).toEqual([]);
  });

  it("allows a type predicate that is the point of a guard function", () => {
    expect(
      reports(`export function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
      }`),
    ).toEqual([]);
  });
});
