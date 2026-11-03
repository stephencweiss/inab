import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { isRecord } from "../../src/storage/rows.js";
import { temporaryDatabase } from "../helpers/database.js";
import { parseArguments } from "../../src/cli/parse.js";
import { isSetupArguments, parseSetupArguments } from "../../src/cli/setup-parse.js";
import { runCli } from "../helpers/cli.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
function parseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error("Expected string array");
  return value;
}
function validateTarget(args: string[]) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "--version")) return;
  if (isSetupArguments(args)) {
    validateSetupTarget(args);
    return;
  }
  const parsed = parseArguments(
    args.map((arg) =>
      ["${revision}", "${transactionRevision}", "${snapshotRevision}"].includes(arg) ? "1" : arg,
    ),
  );
  if (parsed.action === "backup") {
    if (parsed.database === "${database}" && parsed.destination === "${backup}") return;
    throw new Error("Fixed temporary backup targets required");
  }
  if (parsed.action === "restore") {
    if (parsed.source === "${backup}" && parsed.destination === "${restored}") return;
    throw new Error("Fixed temporary restore targets required");
  }
  const restoredReads = ["list", "show", "register", "snapshot-list", "reconciliation-list"];
  if (parsed.database === "${database}") return;
  if (parsed.database === "${restored}" && restoredReads.includes(parsed.action)) return;
  throw new Error("Temporary database target required");
}
function validateSetupTarget(args: string[]) {
  const parsed = parseSetupArguments(args.map((arg) => (arg === "${reviewRevision}" ? "1" : arg)));
  const readOnly = parsed.action === "status" || parsed.action.startsWith("history-");
  if (parsed.database !== "${database}" && !(parsed.database === "${restored}" && readOnly))
    throw new Error("Fixed temporary setup target required");
  const paths = new Map([
    ["--register", "${registerCsv}"],
    ["--plan", "${planCsv}"],
    ["--review", "${review}"],
  ]);
  for (const [flag, expected] of paths) {
    const actual = parsed.flags.get(flag);
    if (actual !== undefined && actual !== expected)
      throw new Error("Fixed synthetic migration path required");
  }
  if (parsed.action === "preview" && [...paths.keys()].some((flag) => !parsed.flags.has(flag)))
    throw new Error("Complete migration fixtures required");
}
function parseStep(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.command !== "string" ||
    value.command !== "node --import tsx src/cli/main.ts" ||
    typeof value.exitStatus !== "number" ||
    !Number.isInteger(value.exitStatus) ||
    value.exitStatus < 0 ||
    value.exitStatus > 4 ||
    typeof value.captureAccount !== "boolean"
  )
    throw new Error("Invalid step structure");
  const args = parseStrings(value.args);
  validateTarget(args);
  return {
    command: value.command,
    args,
    promptAnswers: parseStrings(value.promptAnswers),
    exitStatus: value.exitStatus,
    captureAccount: value.captureAccount,
    captureReview: value.captureReview === true,
    captureImport: value.captureImport === true,
    captureSnapshot: value.captureSnapshot === true,
    captureTransaction: value.captureTransaction === true,
    captureReconciliation: value.captureReconciliation === true,
    stdoutContains: parseStrings(value.stdoutContains),
    stderrContains: parseStrings(value.stderrContains),
  };
}
function parseMap(value: unknown) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.workflows) ||
    value.workflows.length === 0
  )
    throw new Error("Invalid map structure");
  const ids = new Set<string>();
  return value.workflows.map((workflow: unknown) => {
    if (
      !isRecord(workflow) ||
      typeof workflow.id !== "string" ||
      !/^terminal\.[a-z.]+$/.test(workflow.id) ||
      typeof workflow.name !== "string" ||
      !workflow.name.trim() ||
      !Array.isArray(workflow.steps) ||
      workflow.steps.length === 0
    )
      throw new Error("Invalid workflow structure");
    if (ids.has(workflow.id)) throw new Error("Duplicate workflow ID");
    ids.add(workflow.id);
    const sources = parseStrings(workflow.sourceFiles);
    if (
      sources.length === 0 ||
      sources.some(
        (path) =>
          !path.startsWith("src/") || path.includes("..") || !existsSync(resolve(root, path)),
      )
    )
      throw new Error("Broken source reference");
    return {
      id: workflow.id,
      name: workflow.name,
      prerequisites: parseStrings(workflow.prerequisites),
      sourceFiles: sources,
      steps: workflow.steps.map(parseStep),
    };
  });
}
function parseCapturedAccount(output: string) {
  const parsed: unknown = JSON.parse(output);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.account) ||
    typeof parsed.account.id !== "string" ||
    typeof parsed.account.revision !== "number"
  )
    throw new Error("Cannot capture account ID/revision");
  return { id: parsed.account.id, revision: parsed.account.revision };
}
function parseCapturedTransaction(output: string) {
  const parsed: unknown = JSON.parse(output);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.transaction) ||
    typeof parsed.transaction.id !== "string" ||
    typeof parsed.transaction.revision !== "number"
  )
    throw new Error("Cannot capture transaction ID/revision");
  return { id: parsed.transaction.id, revision: parsed.transaction.revision };
}
function parseCapturedSnapshot(output: string) {
  const parsed: unknown = JSON.parse(output);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.snapshot) ||
    typeof parsed.snapshot.id !== "string" ||
    typeof parsed.snapshot.revision !== "number"
  )
    throw new Error("Cannot capture snapshot ID/revision");
  return { id: parsed.snapshot.id, revision: parsed.snapshot.revision };
}
function parseCapturedReconciliation(output: string) {
  const parsed: unknown = JSON.parse(output);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.reconciliation) ||
    typeof parsed.reconciliation.id !== "string"
  )
    throw new Error("Cannot capture reconciliation ID");
  return parsed.reconciliation.id;
}
function captureReviewVariables(stdout: string, variables: Map<string, string>) {
  const result: unknown = JSON.parse(stdout);
  if (
    !isRecord(result) ||
    !Number.isSafeInteger(result.revision) ||
    typeof result.revision !== "number" ||
    !Array.isArray(result.sourceAccounts) ||
    !isRecord(result.sourceAccounts[0]) ||
    typeof result.sourceAccounts[0].key !== "string"
  )
    throw new Error("Cannot capture review");
  variables.set("reviewRevision", String(result.revision));
  variables.set("sourceAccountKey", result.sourceAccounts[0].key);
  if (
    isRecord(result.derived) &&
    Array.isArray(result.derived.accounts) &&
    isRecord(result.derived.accounts[0]) &&
    typeof result.derived.accounts[0].localId === "string"
  )
    variables.set("importAccountId", result.derived.accounts[0].localId);
}
function captureVariables(
  step: ReturnType<typeof parseStep>,
  stdout: string,
  variables: Map<string, string>,
) {
  if (step.captureReview) captureReviewVariables(stdout, variables);
  if (step.captureImport) {
    const result: unknown = JSON.parse(stdout);
    if (!isRecord(result) || typeof result.importId !== "string")
      throw new Error("Cannot capture import");
    variables.set("importId", result.importId);
  }
  if (step.captureSnapshot) {
    const captured = parseCapturedSnapshot(stdout);
    variables.set("snapshotId", captured.id);
    variables.set("snapshotRevision", String(captured.revision));
  }
  if (step.captureReconciliation)
    variables.set("reconciliationId", parseCapturedReconciliation(stdout));
  if (step.captureTransaction) {
    const captured = parseCapturedTransaction(stdout);
    variables.set("transactionId", captured.id);
    variables.set("transactionRevision", String(captured.revision));
  }
  if (step.captureAccount) {
    const captured = parseCapturedAccount(stdout);
    variables.set("accountId", captured.id);
    variables.set("revision", String(captured.revision));
  }
}
it.each(parseMap(JSON.parse(readFileSync(resolve(root, "docs/agent/feature_map.json"), "utf8"))))(
  "executes validated workflow $id through its exact terminal commands",
  (workflow) => {
    const fixture = temporaryDatabase();
    const variables = new Map([
      ["registerCsv", join(fixture.directory, "register.csv")],
      ["planCsv", join(fixture.directory, "plan.csv")],
      ["review", join(fixture.directory, "review.json")],
      ["database", fixture.path],
      ["backup", join(fixture.directory, "recovery", "backup.sqlite")],
      ["restored", join(fixture.directory, "restored", "plan.sqlite")],
    ]);
    const substitute = (text: string) =>
      text.replace(
        /\$\{(database|backup|restored|accountId|revision|transactionId|transactionRevision|reconciliationId|snapshotId|snapshotRevision|registerCsv|planCsv|review|reviewRevision|sourceAccountKey|importAccountId|importId)\}/g,
        (_, key: string) => {
          const value = variables.get(key);
          if (value === undefined) throw new Error(`Missing captured variable: ${key}`);
          return value;
        },
      );
    try {
      if (workflow.id.startsWith("terminal.setup.")) {
        cpSync(
          resolve(root, "tests/fixtures/ynab/register.csv"),
          join(fixture.directory, "register.csv"),
        );
        cpSync(resolve(root, "tests/fixtures/ynab/plan.csv"), join(fixture.directory, "plan.csv"));
      }
      expect(workflow.prerequisites.length).toBeGreaterThan(0);
      for (const step of workflow.steps) {
        expect(step.promptAnswers).toEqual([]);
        const result = runCli(step.args.map(substitute), fixture.directory);
        expect(result.status, `${workflow.id}: ${result.stderr}`).toBe(step.exitStatus);
        for (const signal of step.stdoutContains)
          expect(result.stdout).toContain(substitute(signal));
        for (const signal of step.stderrContains)
          expect(result.stderr).toContain(substitute(signal));
        captureVariables(step, result.stdout, variables);
      }
    } finally {
      fixture.cleanup();
    }
  },
  30_000,
);
it("rejects bad structure, duplicate workflow IDs, and broken source references", () => {
  const valid = {
    id: "terminal.accounts.manage",
    name: "Synthetic",
    prerequisites: ["Temporary synthetic database"],
    sourceFiles: ["src/cli/main.ts"],
    steps: [
      {
        command: "node --import tsx src/cli/main.ts",
        args: ["--help"],
        promptAnswers: [],
        exitStatus: 0,
        captureAccount: false,
        stdoutContains: ["Usage"],
        stderrContains: [],
      },
    ],
  };
  expect(parseStep({ ...valid.steps[0], captureReconciliation: true })).toMatchObject({
    captureReconciliation: true,
  });
  expect(parseMap({ version: 1, workflows: [valid] })).toHaveLength(1);
  expect(() => parseMap({ version: 1, workflows: [valid, valid] })).toThrow("Duplicate");
  expect(() =>
    parseMap({ version: 1, workflows: [{ ...valid, sourceFiles: ["src/missing.ts"] }] }),
  ).toThrow("Broken source");
  expect(() =>
    parseMap({
      version: 1,
      workflows: [
        {
          ...valid,
          steps: [
            { ...valid.steps[0], args: ["--db", "/synthetic/literal.sqlite", "account", "list"] },
          ],
        },
      ],
    }),
  ).toThrow("Temporary database target required");
  for (const invalid of [
    null,
    {},
    { version: 1, workflows: [] },
    { version: 1, workflows: [{ ...valid, steps: [{}] }] },
    { version: 1, workflows: [{ ...valid, name: 4 }] },
  ])
    expect(() => parseMap(invalid)).toThrow();
});

it("validates all recovery read and write paths before workflow execution", () => {
  for (const args of [
    ["backup", "--db", "${database}", "--to", "${backup}", "--confirm"],
    ["restore", "--from", "${backup}", "--to", "${restored}", "--confirm"],
    ["--db", "${restored}", "account", "list"],
  ])
    expect(() => validateTarget(args)).not.toThrow();
  for (const args of [
    ["backup", "--db", "${database}", "--to", "/synthetic/literal.sqlite", "--confirm"],
    ["backup", "--db", "/synthetic/literal.sqlite", "--to", "${backup}", "--confirm"],
    ["restore", "--from", "/synthetic/literal.sqlite", "--to", "${restored}", "--confirm"],
    ["restore", "--from", "${backup}", "--to", "/synthetic/literal.sqlite", "--confirm"],
    ["backup", "--db", "${database}", "--to", "${arbitrary}", "--confirm"],
    ["restore", "--from", "${database}", "--to", "${restored}", "--confirm"],
    ["restore", "--from", "${backup}", "--to", "${restored}/../escape", "--confirm"],
    ["backup", "--db", "${database}", "--from", "${backup}", "--confirm"],
    ["restore", "--db", "${database}", "--from", "${backup}", "--to", "${restored}", "--confirm"],
    ["--db", "${restored}", "init", "--confirm"],
    ["backup", "--db", "${database}", "--confirm"],
    ["restore", "--to", "${restored}", "--confirm"],
  ])
    expect(() => validateTarget(args)).toThrow();
});
it("restricts migration review and source paths to fixed synthetic fixtures", () => {
  const preview = [
    "--db",
    "${database}",
    "setup",
    "migrate",
    "preview",
    "--register",
    "${registerCsv}",
    "--plan",
    "${planCsv}",
    "--review",
    "${review}",
    "--json",
  ];
  expect(() => validateTarget(preview)).not.toThrow();
  for (const key of ["${registerCsv}", "${planCsv}", "${review}", "${database}"]) {
    expect(() =>
      validateTarget(preview.map((v) => (v === key ? "/synthetic/escape" : v))),
    ).toThrow();
    expect(() =>
      validateTarget(preview.map((v) => (v === key ? `${key}/../escape` : v))),
    ).toThrow();
  }
});
