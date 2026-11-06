import { createAccounts } from "../../src/application/accounts.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { initializeDatabase } from "../../src/storage/database.js";
import { temporaryDatabase } from "./database.js";
import type { BudgetFacts } from "../../src/budget/types.js";
export async function budgetFixture() {
  const fixture = temporaryDatabase();
  await initializeDatabase(fixture.path);
  let next = 0;
  const runtime = {
    id: () => `synthetic-${++next}`,
    today: () => "2026-11-05",
    now: () => "2026-11-05T12:00:00.000Z",
  };
  const app = createAccounts(createAccountStore(fixture.path), runtime);
  const preview = app.previewAdd({
    name: "Synthetic Cash",
    kind: "cash",
    currency: "USD",
    openingCents: 100000,
    openingDate: "2026-09-30",
  });
  if (!preview.ok) throw new Error(preview.reason);
  const saved = app.commit(preview.value);
  if (!saved.ok) throw new Error(saved.reason);
  const accountId = saved.value.account.id;
  const facts: BudgetFacts = {
    startMonth: "2026-10",
    currency: "USD",
    opening: {
      accounts: [
        {
          accountId,
          kind: "cash",
          balanceCents: 100000,
          closed: false,
          evidence: "Synthetic statement",
        },
      ],
      categories: [{ categoryId: "food", availableCents: 0, evidence: "Confirmed zero" }],
      readyToAssignCents: 100000,
      evidence: "Synthetic opening",
      deficitAcknowledged: false,
    },
    categories: [
      { id: "food", groupId: "living", name: "Food", archived: false, cardAccountId: null },
    ],
    assignments: [
      { month: "2026-10", categoryId: "food", amountCents: 0 },
      { month: "2026-11", categoryId: "food", amountCents: 0 },
    ],
    events: [],
  };
  return { ...fixture, runtime, facts, accountId };
}
