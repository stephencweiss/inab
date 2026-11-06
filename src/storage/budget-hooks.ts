import { eq, or } from "drizzle-orm";
import type {
  TransactionFailure,
  ManualTransaction,
  AccountPreview,
  TransactionPreview,
} from "../application/ports.js";
import { budgetState } from "./schema/budget.js";
import { budgetEvents } from "./schema/allocations.js";
import { budgetTransfers } from "./schema/transfers.js";
import type { BudgetQueries } from "./budget-facts.js";
type HookQueries = Pick<BudgetQueries, "select" | "update">;
export function budgetTransactionGuard(
  db: Pick<HookQueries, "select">,
  before: ManualTransaction | null,
  after: ManualTransaction,
): TransactionFailure | null {
  if (before === null) return null;
  const moneyChanged = before.cents !== after.cents,
    dateChanged = before.occurredOn !== after.occurredOn;
  if (!moneyChanged && !dateChanged) return null;
  const linked = db
    .select()
    .from(budgetTransfers)
    .where(
      or(
        eq(budgetTransfers.fromTransactionId, before.id),
        eq(budgetTransfers.toTransactionId, before.id),
      ),
    )
    .get();
  if (linked) return "linked-transfer";
  const event = db
    .select()
    .from(budgetEvents)
    .where(eq(budgetEvents.transactionId, before.id))
    .get();
  return moneyChanged && event?.allocation === "categories"
    ? "budget-allocation-replacement-required"
    : null;
}
export function touchBudgetAccount(db: HookQueries, preview: AccountPreview) {
  const changed =
    preview.after.kind !== "tracking" &&
    (preview.before === null ||
      preview.before.openingDate !== preview.after.openingDate ||
      preview.before.openingCents !== preview.after.openingCents);
  if (!changed) return;
  const state = db.select().from(budgetState).get();
  if (!state) return;
  db.update(budgetState)
    .set({ revision: state.revision + 1, status: "needs-review" })
    .where(eq(budgetState.singleton, 1))
    .run();
}
export function touchBudgetTransaction(db: HookQueries, preview: TransactionPreview) {
  const state = db.select().from(budgetState).get();
  if (!state) return;
  const before = preview.before,
    after = preview.after;
  const changed =
    before === null ||
    before.cents !== after.cents ||
    before.occurredOn !== after.occurredOn ||
    before.postedOn !== after.postedOn;
  if (!changed) return;
  const guard = budgetTransactionGuard(db, before, after);
  if (guard) throw new Error(guard);
  const old = db.select().from(budgetEvents).where(eq(budgetEvents.transactionId, after.id)).get();
  const boundary = `${state.startMonth}-01`;
  const membershipChanged =
    before !== null &&
    before.occurredOn !== after.occurredOn &&
    (before.occurredOn < boundary || after.occurredOn < boundary);
  const oldPeriodChanged =
    after.occurredOn < boundary && (before === null || before.cents !== after.cents);
  const needsReview = membershipChanged || oldPeriodChanged;
  if (old && !needsReview)
    db.update(budgetEvents)
      .set({
        cents: after.cents,
        date: before?.occurredOn === after.occurredOn ? old.date : after.occurredOn,
        revision: old.revision + 1,
      })
      .where(eq(budgetEvents.id, old.id))
      .run();
  db.update(budgetState)
    .set({ revision: state.revision + 1, status: needsReview ? "needs-review" : state.status })
    .where(eq(budgetState.singleton, 1))
    .run();
}
