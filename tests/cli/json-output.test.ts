import { spawnSync } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { budgetFixture } from "../helpers/budget.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
function launch(args: string[], stdoutTTY: boolean | null, stderrTTY: boolean) {
  const entry = new URL("../../src/cli/main.ts", import.meta.url).href;
  const script = `
    if (${JSON.stringify(stdoutTTY)} !== null) Object.defineProperty(process.stdout, "isTTY", { value: ${JSON.stringify(stdoutTTY)} });
    Object.defineProperty(process.stderr, "isTTY", { value: ${JSON.stringify(stderrTTY)} });
    process.argv = [process.execPath, "inab", ...${JSON.stringify([...args, "--json"])}];
    await import(${JSON.stringify(entry)});
  `;
  return spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10000 },
  );
}
it.each(["accounts", "setup", "budget"])(
  "indents %s JSON only when stdout is a terminal",
  async (family) => {
    const f = await budgetFixture();
    fixtures.push(f);
    const args = family === "accounts" ? ["account", "list"] : [family, "status"];
    const terminal = launch(["--db", f.path, ...args], true, false);
    expect(terminal.status, terminal.stderr).toBe(0);
    expect(terminal.stdout).toContain('\n  "ok": true,\n');
    expect(terminal.stdout.endsWith("\n")).toBe(true);
    const piped = launch(["--db", f.path, ...args], null, true);
    expect(piped.status, piped.stderr).toBe(0);
    expect(piped.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(terminal.stdout)).toEqual(JSON.parse(piped.stdout));
  },
);
it.each(["setup", "budget", "recovery"])(
  "formats %s JSON errors using stderr independently",
  async (family) => {
    const f = await budgetFixture();
    fixtures.push(f);
    const args =
      family === "recovery"
        ? [
            "restore",
            "--from",
            join(f.directory, "missing.sqlite"),
            "--to",
            join(f.directory, "restored.sqlite"),
            "--confirm",
          ]
        : [family, "status"];
    const terminal = launch(args, false, true);
    expect(terminal.status).not.toBe(0);
    expect(terminal.stdout).toBe("");
    expect(terminal.stderr).toContain('\n  "ok": false,\n');
    const piped = launch(args, true, false);
    expect(piped.status).toBe(terminal.status);
    expect(piped.stdout).toBe("");
    expect(piped.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(terminal.stderr)).toEqual(JSON.parse(piped.stderr));
  },
);
it("keeps redirected file output compact", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const path = join(f.directory, "accounts.json"),
    fd = openSync(path, "wx");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        new URL("../../src/cli/main.ts", import.meta.url).pathname,
        "--db",
        f.path,
        "account",
        "list",
        "--json",
      ],
      { stdio: ["ignore", fd, "pipe"], encoding: "utf8", timeout: 10000 },
    );
    expect(result.status, result.stderr).toBe(0);
  } finally {
    closeSync(fd);
  }
  const output = readFileSync(path, "utf8");
  expect(output.trimEnd().split("\n")).toHaveLength(1);
  expect(JSON.parse(output)).toMatchObject({ ok: true, accounts: [{ id: f.accountId }] });
});
it("preserves non-JSON terminal abandonment output", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const path = join(f.directory, "review.json");
  expect(
    launch(
      ["--db", f.path, "budget", "activation", "start", "--month", "2026-11", "--review", path],
      false,
      false,
    ).status,
  ).toBe(0);
  const entry = new URL("../../src/cli/budget.ts", import.meta.url).href,
    prompts = new URL("../../src/cli/prompts.ts", import.meta.url).href;
  const script = `Object.defineProperty(process.stdout,"isTTY",{value:true}); const {runBudgetArguments}=await import(${JSON.stringify(entry)});const {PromptCancelled}=await import(${JSON.stringify(prompts)});await runBudgetArguments(${JSON.stringify(["--db", f.path, "budget", "activation", "review", "--review", path, "--interactive"])},{interactive:true,ask:async()=>{throw new PromptCancelled();}});`;
  const result = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('{"ok":true,"canceled":true}\n');
});
