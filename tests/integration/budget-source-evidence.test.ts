import { afterEach, expect, it } from "vitest";
import { budgetFixture } from "../helpers/budget.js";
import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { validateActivation } from "../../src/application/budget-activation.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("rejects reuse of one imported debit across two historical transfer pairs", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const accounts = createAccounts(createAccountStore(f.path), f.runtime),
    p = accounts.previewAdd({
      name: "Other Cash",
      kind: "cash",
      currency: "USD",
      openingCents: 0,
      openingDate: "2026-09-30",
    });
  if (!p.ok) throw new Error(p.reason);
  const saved = accounts.commit(p.value);
  if (!saved.ok) throw new Error(saved.reason);
  const other = saved.value.account.id;
  const snapshot = createBudget(createBudgetStore(f.path), f.runtime).inspect();
  snapshot.accounts = snapshot.accounts.map((a) =>
    a.kind === "cash"
      ? { ...a, openingDate: "2026-10-31", openingCents: a.id === f.accountId ? 99900 : 100 }
      : a,
  );
  snapshot.sourceRows = [
    {
      id: "r1",
      accountId: f.accountId,
      date: "2026-10-10",
      cents: -100,
      role: "transaction",
      transactionId: null,
    },
    {
      id: "r2",
      accountId: other,
      date: "2026-10-10",
      cents: 100,
      role: "transaction",
      transactionId: null,
    },
    {
      id: "r3",
      accountId: other,
      date: "2026-10-10",
      cents: 100,
      role: "transaction",
      transactionId: null,
    },
  ];
  const facts = {
    ...f.facts,
    opening: {
      ...f.facts.opening,
      accounts: [
        ...f.facts.opening.accounts,
        {
          accountId: other,
          kind: "cash" as const,
          balanceCents: 0,
          closed: false,
          evidence: "Zero",
        },
      ],
    },
    events: [
      {
        kind: "transfer" as const,
        id: "one",
        sourceId: "history|r1|r2",
        date: "2026-10-10",
        order: 0,
        fromAccountId: f.accountId,
        toAccountId: other,
        amountCents: 100,
        categoryId: null,
      },
      {
        kind: "transfer" as const,
        id: "two",
        sourceId: "history|r1|r3",
        date: "2026-10-10",
        order: 1,
        fromAccountId: f.accountId,
        toAccountId: other,
        amountCents: 100,
        categoryId: null,
      },
    ],
  };
  const coverage = {
    throughDate: "2026-11-05",
    evidence: "Reviewed sources",
    includedTransactionIds: [],
    postedBridgeEventIds: ["one"],
  };
  expect(validateActivation(snapshot, facts, coverage, "2026-11-05")).toEqual({
    ok: false,
    reason: "duplicate-source-effect",
  });
  const valid = { ...facts, events: [facts.events[0]!] };
  snapshot.sourceRows = snapshot.sourceRows.slice(0, 2);
  expect(validateActivation(snapshot, valid, coverage, "2026-11-05").ok).toBe(true);
  expect(
    validateActivation(
      snapshot,
      { ...valid, events: valid.events.map((e) => ({ ...e, amountCents: 99 })) },
      coverage,
      "2026-11-05",
    ),
  ).toMatchObject({ ok: false, reason: "transfer-evidence-mismatch" });
});
it("refuses live edit and unlink of budget-only historical transfer evidence", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const accounts = createAccounts(createAccountStore(f.path), f.runtime);
  const corrected = accounts.previewOpening(f.accountId, 1, 99900, "2026-10-31");
  if (!corrected.ok) throw new Error(corrected.reason);
  if (!accounts.commit(corrected.value).ok) throw new Error("opening failed");
  const added = accounts.previewAdd({
    name: "Other",
    kind: "cash",
    currency: "USD",
    openingCents: 100,
    openingDate: "2026-10-31",
  });
  if (!added.ok) throw new Error(added.reason);
  const saved = accounts.commit(added.value);
  if (!saved.ok) throw new Error(saved.reason);
  const other = saved.value.account.id;
  const facts = {
    ...f.facts,
    opening: {
      ...f.facts.opening,
      accounts: [
        ...f.facts.opening.accounts,
        {
          accountId: other,
          kind: "cash" as const,
          balanceCents: 0,
          closed: false,
          evidence: "Zero",
        },
      ],
    },
    events: [
      {
        kind: "transfer" as const,
        id: "history",
        sourceId: "manual:reviewed-transfer",
        date: "2026-10-10",
        order: 0,
        fromAccountId: f.accountId,
        toAccountId: other,
        amountCents: 100,
        categoryId: null,
      },
    ],
  };
  const app = createBudget(createBudgetStore(f.path), f.runtime),
    p = app.preview(
      {
        kind: "activate",
        facts,
        coverage: {
          throughDate: "2026-11-05",
          evidence: "Verified opening bridge",
          includedTransactionIds: [],
          postedBridgeEventIds: ["history"],
        },
      },
      0,
    );
  if (!p.ok) throw new Error(p.reason);
  expect(app.commit(p.value).ok).toBe(true);
  expect(
    app.preview(
      {
        kind: "transfer-edit",
        id: "history",
        date: "2026-10-10",
        amountCents: 200,
        categoryId: null,
        expectedActivityVersion: 1,
      },
      1,
    ),
  ).toMatchObject({ ok: false, reason: "opening-amendment-required" });
  expect(
    app.preview({ kind: "transfer-unlink", id: "history", expectedActivityVersion: 1 }, 1),
  ).toMatchObject({ ok: false, reason: "opening-amendment-required" });
  expect(app.inspect().transactions).toHaveLength(0);
});
it("does not accept budget-only activity missing from a register after its opening", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  const facts = {
    ...f.facts,
    events: [
      {
        kind: "transaction" as const,
        id: "missing-live",
        sourceId: "manual:missing-live",
        date: "2026-10-10",
        order: 0,
        accountId: f.accountId,
        amountCents: -100,
        allocation: { kind: "income" as const },
      },
    ],
  };
  expect(
    app.preview(
      {
        kind: "activate",
        facts,
        coverage: {
          throughDate: "2026-11-05",
          evidence: "Claimed complete",
          includedTransactionIds: [],
          postedBridgeEventIds: [],
        },
      },
      0,
    ),
  ).toMatchObject({ ok: false, reason: "current-account-balance-mismatch" });
});
it("requires explicit budget review for material Cash adjustment source rows", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const snapshot = createBudget(createBudgetStore(f.path), f.runtime).inspect();
  snapshot.sourceRows = [
    {
      id: "adjustment",
      accountId: f.accountId,
      date: "2026-10-10",
      cents: 100,
      role: "adjustment",
      transactionId: null,
    },
  ];
  expect(
    validateActivation(
      snapshot,
      f.facts,
      {
        throughDate: "2026-11-05",
        evidence: "Claimed complete",
        includedTransactionIds: [],
        postedBridgeEventIds: [],
      },
      "2026-11-05",
    ),
  ).toMatchObject({ ok: false, reason: "missing-source-review" });
});
