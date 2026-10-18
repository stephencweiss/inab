import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../../src/storage/database.js";
import { parseArguments } from "../../src/cli/parse.js";
import { completeCommand, PromptCancelled } from "../../src/cli/prompts.js";
import { executeRecovery } from "../../src/cli/backup.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.cleanup());
  vi.restoreAllMocks();
  process.exitCode = 0;
});
async function fixture() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  return f;
}
it("backs up and restores through explicit paths and structured results without --db on restore", async () => {
  const f = await fixture();
  const backup = join(f.directory, "backup.sqlite");
  const restored = join(f.directory, "restored.sqlite");
  const b = runCli(["backup", "--db", f.path, "--to", backup, "--confirm", "--json"], f.directory);
  expect(b.status, b.stderr).toBe(0);
  expect(JSON.parse(b.stdout)).toMatchObject({
    ok: true,
    source: f.path,
    destination: backup,
    schemaVersion: 2,
    migrationNeeded: false,
  });
  expect(JSON.parse(b.stdout).operationId).toEqual(expect.any(String));
  const before = readFileSync(backup);
  const r = runCli(
    ["restore", "--from", backup, "--to", restored, "--confirm", "--json"],
    f.directory,
  );
  expect(r.status, r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, destination: restored });
  expect(readFileSync(backup)).toEqual(before);
  expect(runCli(["--db", restored, "account", "list", "--json"], f.directory).status).toBe(0);
});
it.each([
  ["backup", "--db", "SOURCE", "--to", "DESTINATION"],
  ["backup", "--to", "DESTINATION", "--confirm"],
  ["backup", "--db", "SOURCE", "--confirm"],
  ["restore", "--from", "SOURCE", "--to", "DESTINATION"],
  ["restore", "--to", "DESTINATION", "--confirm"],
  ["restore", "--db", "SOURCE", "--from", "SOURCE", "--to", "DESTINATION", "--confirm"],
  ["backup", "--db", "SOURCE", "--from", "SOURCE", "--to", "DESTINATION", "--confirm"],
])("rejects incomplete or inapplicable command %j without writes", async (...args) => {
  const f = await fixture();
  const destination = join(f.directory, "new.sqlite");
  const result = runCli(
    args.map((arg) => {
      if (arg === "SOURCE") return f.path;
      return arg === "DESTINATION" ? destination : arg;
    }),
    f.directory,
  );
  expect(result.status, result.stderr).toBe(2);
  expect(result.stdout).toBe("");
  expect(existsSync(destination)).toBe(false);
  expect(readdirSync(f.directory)).toEqual(["private"]);
});
it("rejects a missing source without creating it", async () => {
  const f = await fixture();
  const destination = join(f.directory, "new.sqlite");
  const missing = join(f.directory, "typo.sqlite");
  const result = runCli(
    ["backup", "--db", missing, "--to", destination, "--confirm", "--json"],
    f.directory,
  );
  expect(result.status).toBe(3);
  expect(result.stdout).toBe("");
  expect(existsSync(missing)).toBe(false);
  expect(existsSync(destination)).toBe(false);
});
it.each(["no", "cancel", "interrupt"])(
  "prompts for paths and shows source and destination before %s cancellation without writes",
  async (answer) => {
    const f = await fixture();
    const destination = join(f.directory, "new", "restored.sqlite");
    const messages: string[] = [];
    const answers = [f.path, destination];
    vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      messages.push(String(text));
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prompts = {
      interactive: true,
      ask: async (question: string) => {
        if (answers.length) return answers.shift() ?? "";
        expect(messages.join("\n")).toContain(f.path);
        expect(messages.join("\n")).toContain(destination);
        expect(question).toContain("yes/no");
        if (answer !== "no") throw new PromptCancelled();
        return "no";
      },
    };
    const command = await completeCommand(
      parseArguments(["restore", "--json"]),
      prompts,
      "2026-10-17",
    );
    if (answer === "no") await executeRecovery(command, prompts);
    else await expect(executeRecovery(command, prompts)).rejects.toBeInstanceOf(PromptCancelled);
    expect(existsSync(dirname(destination))).toBe(false);
    expect(readdirSync(f.directory)).toEqual(["private"]);
  },
);
it("reports an unexpected write failure with structured operation and destination evidence", async () => {
  const f = await fixture();
  const locked = join(f.directory, "locked");
  mkdirSync(locked, { mode: 0o500 });
  const destination = join(locked, "new.sqlite");
  try {
    const result = runCli(
      ["backup", "--db", f.path, "--to", destination, "--confirm", "--json"],
      f.directory,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "")).toMatchObject({
      ok: false,
      reason: "storage-failure",
      operationId: expect.any(String),
      destination,
    });
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(locked)).toEqual([]);
  } finally {
    chmodSync(locked, 0o700);
  }
});
it("turns a terminal Ctrl+C event into cancellation before any recovery write", async () => {
  const { createInterface } = await import("node:readline/promises");
  const { PassThrough } = await import("node:stream");
  const { askTerminalQuestion } = await import("../../src/cli/prompts.js");
  const input = new PassThrough();
  const output = new PassThrough();
  const terminal = createInterface({ input, output, terminal: true });
  try {
    const question = askTerminalQuestion(terminal, "Apply this change? [yes/no]: ");
    terminal.emit("SIGINT");
    await expect(question).rejects.toBeInstanceOf(PromptCancelled);
  } finally {
    terminal.close();
    input.destroy();
    output.destroy();
  }
});
