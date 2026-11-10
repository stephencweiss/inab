import { eq } from "drizzle-orm";
import { validateRegisterEntry } from "../accounts/balances.js";
import { affectedReconciliations, correctionPostingDate } from "../accounts/reconciliation.js";
import { readReconciliations, invalidateReconciliations } from "./reconciliations.js";
import { budgetSnapshot } from "./budget-facts.js";
import type { BudgetQueries } from "./budget-facts.js";
import type { BudgetPreview } from "../application/budget-ports.js";
import { transactions } from "./schema/transactions.js";
import { accounts } from "./schema/accounts.js";
import { changes } from "./schema/changes.js";
function saveLeg(
  db: BudgetQueries,
  preview: BudgetPreview,
  accountId: string,
  id: string,
  date: string,
  cents: number,
) {
  const snapshot = budgetSnapshot(db),
    account = snapshot.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("account-unavailable");
  if (account.kind === "tracking") return;
  const before = snapshot.transactions.find((t) => t.id === id) ?? null;
  const after = before
    ? {
        ...before,
        occurredOn: date,
        cents,
        revision: before.revision + 1,
        updatedAt: preview.recordedAt,
      }
    : {
        id,
        accountId,
        occurredOn: date,
        postedOn: null,
        cents,
        payee: "Transfer",
        memo: "",
        revision: 1,
        createdAt: preview.recordedAt,
        updatedAt: preview.recordedAt,
      };
  if (before && before.accountId !== accountId) throw new Error("transfer-evidence-mismatch");
  const valid = validateRegisterEntry(account, after, preview.recordedAt.slice(0, 10));
  if (!valid.ok) throw new Error(valid.reason);
  const earliest = correctionPostingDate(before, after);
  const affected =
    earliest === null ? [] : affectedReconciliations(readReconciliations(db, accountId), earliest);
  invalidateReconciliations(db, affected, `${preview.operationId}:${id}`, preview.recordedAt);
  if (before) db.update(transactions).set(after).where(eq(transactions.id, id)).run();
  else db.insert(transactions).values(after).run();
  db.update(accounts)
    .set({ revision: account.revision + 1 })
    .where(eq(accounts.id, accountId))
    .run();
  db.insert(changes)
    .values({
      id: `${preview.operationId}:${id}`,
      operation: "budget.transfer-leg",
      entityId: id,
      beforeJson: before ? JSON.stringify(before) : null,
      afterJson: JSON.stringify(after),
      recordedAt: preview.recordedAt,
    })
    .run();
}
export function saveBudgetTransferLegs(db: BudgetQueries, preview: BudgetPreview) {
  const command = preview.command;
  if (command.kind === "transfer" && preview.transferLegIds) {
    for (const [id, accountId, cents] of [
      [preview.transferLegIds.from, command.fromAccountId, -command.amountCents],
      [preview.transferLegIds.to, command.toAccountId, command.amountCents],
    ] as const) {
      const existing = budgetSnapshot(db).transactions.find((t) => t.id === id);
      if (
        existing &&
        (existing.accountId !== accountId ||
          existing.cents !== cents ||
          existing.occurredOn !== command.date)
      )
        throw new Error("transfer-evidence-mismatch");
      if (!existing) saveLeg(db, preview, accountId, id, command.date, cents);
    }
  }
  if (command.kind === "transfer-edit") editLegs(db, preview, command);
}
function editLegs(
  db: BudgetQueries,
  preview: BudgetPreview,
  command: Extract<BudgetPreview["command"], { kind: "transfer-edit" }>,
) {
  const old = budgetSnapshot(db).state?.facts.events.find((e) => e.id === command.id);
  if (!old || old.kind !== "transfer") throw new Error("activity-unavailable");
  if (!old.sourceId.startsWith("transfer|")) throw new Error("opening-amendment-required");
  const parts = old.sourceId.split("|");
  if (!parts[1] || !parts[2]) throw new Error("historical-transfer-amendment-required");
  saveLeg(db, preview, old.fromAccountId, parts[1], command.date, -command.amountCents);
  saveLeg(db, preview, old.toAccountId, parts[2], command.date, command.amountCents);
}
