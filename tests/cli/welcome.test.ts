import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { cliVersion, terminalWelcome } from "../../src/cli/welcome.js";

it("shows the INAB ASCII banner on terminal launches", () => {
  const output = terminalWelcome(true, ["--help"]);
  expect(output).toContain("    ____   _   __   ___     ____");
  expect(output).toContain("/___/  /_/ |_/  /_/  |_|/_____/");
  expect(output).toContain("\u001b[36m");
  expect(output).toContain("\u001b[1mINAB CLI\u001b[0m");
  expect(output).toContain(`\u001b[32mv${cliVersion}\u001b[0m`);
  expect(output).toContain("Personal envelope budgeting for one household.");
});
it.each([
  { interactive: false, args: ["--help"] },
  { interactive: true, args: ["setup", "status", "--json"] },
  { interactive: true, args: ["--version"] },
])("keeps structured and script output clean for $args", ({ interactive, args }) => {
  expect(terminalWelcome(interactive, args)).toBe("");
});

function launchTerminal(args: string[]) {
  const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
  const script = `
    Object.defineProperty(process.stdin, "isTTY", { value: true });
    Object.defineProperty(process.stderr, "isTTY", { value: true });
    process.argv = [process.execPath, "inab", ...${JSON.stringify(args)}];
    await import(${JSON.stringify(entry)});
  `;
  return spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10000 },
  );
}

it("prints the banner once when the real CLI opens terminal help", () => {
  const result = launchTerminal(["--help"]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr.split("____   _   __   ___     ____")).toHaveLength(2);
  expect(result.stdout).toContain("Usage: inab");
});
it("keeps terminal version output plain", () => {
  const result = launchTerminal(["--version"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${cliVersion}\n`);
  expect(result.stderr).toBe("");
});
it("keeps terminal JSON errors free from the banner", () => {
  const result = launchTerminal(["setup", "status", "--json"]);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("____   _   __   ___     ____");
  expect(JSON.parse(result.stderr)).toMatchObject({ ok: false });
});
