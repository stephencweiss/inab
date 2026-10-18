import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { configs } from "eslint-plugin-sonarjs";
import { describe, expect, it } from "vitest";

const CYCLOMATIC = "complexity";
const COGNITIVE = "sonarjs/cognitive-complexity";

function complexityMessages(messages: ReadonlyArray<{ ruleId: string | null; message: string }>) {
  return messages.filter(
    (message) => message.ruleId === CYCLOMATIC || message.ruleId === COGNITIVE,
  );
}

function expectedSeverity(name: string, presetLevel: unknown): number {
  if (name === "sonarjs/different-types-comparison") return 0;
  if (presetLevel === "off") return 0;
  return 2;
}

function broadFunction(): string {
  const branches = Array.from(
    { length: 21 },
    (_, index) => `  if (value === ${index}) return ${index};`,
  );
  return `export function broad(value: number): number {\n${branches.join("\n")}\n  return value;\n}\n`;
}

describe("lint config", () => {
  it("reports a function over both complexity limits", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(broadFunction(), {
      filePath: "scripts/complexity-sample.ts",
    });
    const reported = complexityMessages(result?.messages ?? []).map((message) => message.ruleId);
    expect(reported).toHaveLength(2);
    expect(reported).toContain(CYCLOMATIC);
    expect(reported).toContain(COGNITIVE);
  });

  it("accepts a function under both complexity limits", async () => {
    const eslint = new ESLint();
    const code =
      "export function small(value: number): number {\n  if (value === 0) return 0;\n  return value;\n}\n";
    const [result] = await eslint.lintText(code, { filePath: "scripts/complexity-sample.ts" });
    expect(complexityMessages(result?.messages ?? [])).toEqual([]);
  });

  it("reports an assertion that copies the value type", async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText(
      "declare function getName(): string;\nexport const name = getName() as string;\n",
      { filePath: "scripts/assertion-sample.ts" },
    );
    const messages = (result?.messages ?? []).filter(
      (message) => message.ruleId === "@typescript-eslint/no-unnecessary-type-assertion",
    );
    expect(messages).toHaveLength(1);
  });

  it("names every sonarjs recommended rule without loading the recommended preset", async () => {
    const eslint = new ESLint();
    const config = await eslint.calculateConfigForFile("vitest.config.ts");
    const source = readFileSync("eslint.config.mjs", "utf8");
    expect(source).not.toContain("sonarjs.configs");
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bconfigs\b[^}]*\}\s*from\s*"eslint-plugin-sonarjs"/,
    );
    const presetRules = configs.recommended.rules ?? {};
    expect(Object.keys(presetRules)).toHaveLength(295);
    for (const [name, presetLevel] of Object.entries(presetRules)) {
      const configured = config.rules?.[name];
      const severity = Array.isArray(configured) ? configured[0] : configured;
      expect(severity, name).toBe(expectedSeverity(name, presetLevel));
    }
    expect(config.rules?.[COGNITIVE]).toEqual([2, 15]);
    expect(config.rules?.[CYCLOMATIC]).toEqual([2, 20]);
  });
});
