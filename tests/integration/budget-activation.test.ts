import { afterEach, expect, it } from "vitest";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { budgetFixture } from "../helpers/budget.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
async function target() {
  const f = await budgetFixture();
  fixtures.push(f);
  return { ...f, app: createBudget(createBudgetStore(f.path), f.runtime) };
}
it("activates an earlier month, retains a receipt, and reports coherent monthly values", async () => {
  const f = await target();
  const snapshot = f.app.inspect();
  expect(snapshot.state).toBeNull();
  const preview = f.app.preview(
    {
      kind: "activate",
      facts: f.facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "All synthetic activity checked",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    0,
  );
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  const saved = f.app.commit(preview.value);
  expect(saved.ok).toBe(true);
  expect(f.app.report("2026-11")).toMatchObject({
    ok: true,
    value: { revision: 1, status: "active", month: { readyToAssignCents: 100000, complete: true } },
  });
  expect(f.app.commit(preview.value)).toMatchObject({
    ok: true,
    value: { reused: true, revision: 1 },
  });
});
it("refuses a stale activation after an account change and keeps the budget inactive", async () => {
  const f = await target();
  const p = f.app.preview(
    {
      kind: "activate",
      facts: f.facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Checked",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    0,
  );
  if (!p.ok) throw new Error(p.reason);
  const { createAccounts } = await import("../../src/application/accounts.js");
  const { createAccountStore } = await import("../../src/storage/accounts.js");
  const accounts = createAccounts(createAccountStore(f.path), f.runtime);
  const rename = accounts.previewRename(f.accountId, 1, "Changed");
  if (!rename.ok) throw new Error(rename.reason);
  expect(accounts.commit(rename.value).ok).toBe(true);
  expect(f.app.commit(p.value)).toMatchObject({ ok: false, reason: "stale-version" });
  expect(f.app.inspect().state).toBeNull();
});
it("rejects missing elapsed assignments and unexplained boundary balances", async () => {
  const f = await target();
  const coverage = {
    throughDate: "2026-11-05",
    evidence: "Checked",
    includedTransactionIds: [],
    postedBridgeEventIds: [],
  };
  expect(
    f.app.preview({ kind: "activate", facts: { ...f.facts, assignments: [] }, coverage }, 0),
  ).toMatchObject({ ok: false, reason: "missing-month-assignment" });
  const facts = {
    ...f.facts,
    opening: {
      ...f.facts.opening,
      accounts: [{ ...f.facts.opening.accounts[0]!, balanceCents: 90000 }],
      readyToAssignCents: 90000,
    },
  };
  expect(f.app.preview({ kind: "activate", facts, coverage }, 0)).toMatchObject({
    ok: false,
    reason: "opening-account-mismatch",
  });
});
it("rolls back activation and audit after an injected save failure", async () => {
  const f = await target();
  const app = createBudget(
    createBudgetStore(f.path, () => {
      throw new Error("synthetic save failure");
    }),
    f.runtime,
  );
  const p = app.preview(
    {
      kind: "activate",
      facts: f.facts,
      coverage: {
        throughDate: "2026-11-05",
        evidence: "Checked",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
    },
    0,
  );
  if (!p.ok) throw new Error(p.reason);
  expect(() => app.commit(p.value)).toThrow("Operation ID");
  expect(f.app.inspect().state).toBeNull();
});
