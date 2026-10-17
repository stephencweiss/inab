import { afterEach, expect, it, vi } from "vitest";
import { createAccounts } from "../../src/application/accounts.js";
import { createTransactions } from "../../src/application/transactions.js";
import { createReconciliations } from "../../src/application/reconcile.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createTransactionStore } from "../../src/storage/transactions.js";
import { createReconciliationStore } from "../../src/storage/reconciliations.js";
import { initializeDatabase } from "../../src/storage/database.js";
import { parseArguments } from "../../src/cli/parse.js";
import { executeTransaction } from "../../src/cli/transactions.js";
import { PromptCancelled } from "../../src/cli/prompts.js";
import { temporaryDatabase } from "../helpers/database.js";
import { runCli } from "../helpers/cli.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function setup() {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const runtime = {
    id: () => crypto.randomUUID(),
    now: () => "2026-10-17T12:00:00.000Z",
    today: () => "2026-10-17",
  };
  const accounts = createAccounts(createAccountStore(f.path), runtime);
  const p = accounts.previewAdd({
    name: "Synthetic",
    kind: "cash",
    currency: "USD",
    openingCents: 100000,
    openingDate: "2026-10-01",
  });
  if (!p.ok) throw new Error("Expected account");
  accounts.commit(p.value);
  const id = p.value.after.id;
  const tx = createTransactions(createTransactionStore(f.path), runtime);
  const t = tx.previewAdd(id, {
    cents: -2500,
    occurredOn: "2026-10-04",
    postedOn: "2026-10-05",
    payee: "Synthetic",
    memo: "",
  });
  if (!t.ok) throw new Error("Expected transaction");
  tx.commit(t.value);
  const checks = createReconciliations(createReconciliationStore(f.path), runtime);
  const r = checks.preview(id, "2026-10-17", 97500);
  if (!r.ok) throw new Error("Expected reconciliation");
  checks.commit(r.value);
  return {
    ...f,
    id,
    entryId: t.value.after.id,
    checkId: r.value.operationId,
    tx,
    checks,
    run: (args: string[]) => runCli(["--db", f.path, ...args], f.directory),
  };
}
it("requires confirmation and returns affected check IDs and dates with corrected results", async () => {
  const f = await setup();
  const args = ["transaction", "unclear", f.entryId, "--expected-version", "1", "--json"];
  expect(f.run(args).status).toBe(2);
  const result = f.run([...args, "--confirm"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    affectedReconciliations: [{ id: f.checkId, cutoffDate: "2026-10-17" }],
  });
  const list = f.run(["reconciliation", "list", "--account", f.id, "--json"]);
  expect(JSON.parse(list.stdout).reconciliations).toMatchObject([
    { status: "needs-review", entries: [{ cents: -2500, transactionRevision: 1 }] },
  ]);
  const renewed = f.run([
    "reconcile",
    f.id,
    "--as-of",
    "2026-10-17",
    "--bank-balance",
    "1000",
    "--confirm",
    "--json",
  ]);
  expect(renewed.status, renewed.stderr).toBe(0);
  expect(JSON.parse(renewed.stdout).reconciliation.status).toBe("valid");
  const opening = f.run([
    "account",
    "opening",
    f.id,
    "--amount",
    "1001",
    "--as-of",
    "2026-10-01",
    "--expected-version",
    "3",
    "--confirm",
    "--json",
  ]);
  expect(opening.status, opening.stderr).toBe(0);
  expect(JSON.parse(opening.stdout).affectedReconciliations).toHaveLength(1);
});
it("shows affected checks before confirmation and cancels without writes", async () => {
  const f = await setup();
  const command = parseArguments([
    "--db",
    f.path,
    "transaction",
    "unclear",
    f.entryId,
    "--expected-version",
    "1",
    "--json",
  ]);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await executeTransaction(command, { interactive: true, ask: async () => "no" });
    expect(stderr.mock.calls.map((c) => c[0]).join("")).toContain(`${f.checkId} | 2026-10-17`);
    expect(stdout.mock.calls.map((c) => c[0]).join("")).toContain('"canceled":true');
    await expect(
      executeTransaction(command, {
        interactive: true,
        ask: async () => {
          throw new PromptCancelled();
        },
      }),
    ).rejects.toBeInstanceOf(PromptCancelled);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  expect(f.checks.list(f.id)).toMatchObject({ ok: true, value: [{ status: "valid" }] });
  expect(f.tx.register(f.id)).toMatchObject({
    ok: true,
    value: { account: { revision: 2 }, entries: [{ revision: 1, clearance: "reconciled" }] },
  });
});
