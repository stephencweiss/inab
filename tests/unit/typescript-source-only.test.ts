import { createRequire } from "node:module";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const rule = require("../../tools/eslint-plugin-typescript-only/typescript-source-only.cjs");

const linter = new Linter({ configType: "flat" });

function lint(filename: string) {
  return linter.verify(
    "export const value = 1;\n",
    [
      {
        files: ["**/*.{js,jsx,mjs,cjs,mts,cts,ts,tsx}"],
        plugins: {
          "typescript-only": {
            rules: {
              "typescript-source-only": rule,
            },
          },
        },
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
        },
        rules: {
          "typescript-only/typescript-source-only": "error",
        },
      },
    ],
    filename,
  );
}

describe("typescript-source-only", () => {
  it("reports a JavaScript file under src", () => {
    const messages = lint("src/cli/entry.js");

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("typescript-only/typescript-source-only");
    expect(messages[0]?.message).toContain(".js");
    expect(messages[0]?.message).toContain(".ts");
  });

  it("reports the other script extensions that are not accepted", () => {
    for (const extension of [".jsx", ".mjs", ".cjs", ".mts", ".cts"]) {
      const messages = lint(`src/lib/entry${extension}`);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe("typescript-only/typescript-source-only");
    }
  });

  it("allows TypeScript under src", () => {
    expect(lint("src/cli/entry.ts")).toEqual([]);
    expect(lint("src/cli/entry.tsx")).toEqual([]);
  });

  it("allows JavaScript outside src", () => {
    expect(lint("tools/plugin.cjs")).toEqual([]);
    expect(lint("eslint.config.mjs")).toEqual([]);
  });
});
