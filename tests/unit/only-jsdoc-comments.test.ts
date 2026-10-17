import { createRequire } from "node:module";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rule = require("../../tools/eslint-plugin-inab/comments.cjs");

const linter = new Linter({ configType: "flat" });

function lint(code: string, allow?: string[]) {
  return linter.verify(code, [
    {
      plugins: {
        "only-jsdoc": {
          rules: {
            "only-jsdoc-comments": rule,
          },
        },
      },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      rules: {
        "only-jsdoc/only-jsdoc-comments": allow ? ["error", { allow }] : "error",
      },
    },
  ]);
}

describe("only-jsdoc-comments", () => {
  it("allows a JSDoc block comment", () => {
    expect(lint("/** Documents the constraint. */\nexport const n = 1;\n")).toEqual([]);
  });

  it("reports a line comment", () => {
    const messages = lint("export const n = 1; // note\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain("allow");
  });

  it("reports a non-JSDoc block comment", () => {
    expect(lint("/* note */\nexport const n = 1;\n")).toHaveLength(1);
  });

  it("allows a comment that starts with approved: and a reason", () => {
    expect(lint("// approved: the directive has no JSDoc form\nexport const n = 1;\n")).toEqual([]);
  });

  it("rejects an approved: comment with no reason", () => {
    expect(lint("// approved:\nexport const n = 1;\n")).toHaveLength(1);
  });

  it("allows eslint and TypeScript directive comments", () => {
    const code = [
      "// eslint-enable no-console",
      "// @ts-expect-error fixture",
      "export const n = 1;",
      '/// <reference types="node" />',
      "",
    ].join("\n");
    const messages = lint(code).filter(
      (message) => message.ruleId === "only-jsdoc/only-jsdoc-comments",
    );
    expect(messages).toEqual([]);
  });

  it("uses a custom allowlist instead of the default hatch", () => {
    expect(lint("// keep: reviewed exception\nexport const n = 1;\n", ["^keep:"])).toEqual([]);
    expect(
      lint("// approved: this hatch is not on the custom list\nexport const n = 1;\n", ["^keep:"]),
    ).toHaveLength(1);
  });
});
