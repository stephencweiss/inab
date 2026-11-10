import { eq } from "drizzle-orm";
import { openDatabase } from "./database.js";
import { migrationsFolder, validateMigrationHistory } from "./migration-history.js";
import { budgetSnapshot } from "./budget-facts.js";
import type { BudgetQueries } from "./budget-facts.js";
import { budgetState } from "./schema/budget.js";
import { budgetGroups, budgetCategories, budgetAssignments } from "./schema/categories.js";
import { budgetEvents, budgetAllocations, budgetSourceMemberships } from "./schema/allocations.js";
import { budgetSourceRows } from "../application/budget-evidence.js";
import { budgetTransfers } from "./schema/transfers.js";
import { changes } from "./schema/changes.js";
import type { BudgetPreview, BudgetSession, BudgetStore } from "../application/budget-ports.js";
import { saveBudgetTransferLegs } from "./budget-transfers.js";

function writeFacts(db: BudgetQueries, preview: BudgetPreview) {
  const snapshot = budgetSnapshot(db),
    facts = preview.after;
  db.delete(budgetSourceMemberships).run();
  db.delete(budgetAllocations).run();
  db.delete(budgetEvents).run();
  db.delete(budgetTransfers).run();
  db.delete(budgetAssignments).run();
  db.delete(budgetCategories).run();
  db.delete(budgetGroups).run();
  for (const groupId of new Set(facts.categories.map((c) => c.groupId)))
    db.insert(budgetGroups).values({ id: groupId, name: groupId }).run();
  facts.categories.forEach((c, position) =>
    db
      .insert(budgetCategories)
      .values({ ...c, position })
      .run(),
  );
  for (const a of facts.assignments)
    db.insert(budgetAssignments)
      .values({ month: a.month, categoryId: a.categoryId, cents: a.amountCents })
      .run();
  for (const e of facts.events) {
    if (e.kind === "transfer") {
      const parts = e.sourceId.split("|");
      db.insert(budgetTransfers)
        .values({
          id: e.id,
          sourceId: e.sourceId,
          fromAccountId: e.fromAccountId,
          toAccountId: e.toAccountId,
          fromTransactionId: snapshot.transactions.find((t) => t.id === parts[1])?.id ?? null,
          toTransactionId: snapshot.transactions.find((t) => t.id === parts[2])?.id ?? null,
          date: e.date,
          position: e.order,
          cents: e.amountCents,
          categoryId: e.categoryId,
          revision: preview.expectedRevision + 1,
        })
        .run();
    } else {
      db.insert(budgetEvents)
        .values({
          id: e.id,
          sourceId: e.sourceId,
          transactionId: snapshot.transactions.find((t) => t.id === e.id)?.id ?? null,
          sourceRowId: snapshot.sourceRows.find((r) => r.id === e.sourceId)?.id ?? null,
          accountId: e.accountId,
          date: e.date,
          position: e.order,
          cents: e.amountCents,
          allocation: e.allocation.kind,
          revision: preview.expectedRevision + 1,
        })
        .run();
      if (e.allocation.kind === "categories")
        e.allocation.lines.forEach((line, position) =>
          db
            .insert(budgetAllocations)
            .values({
              eventId: e.id,
              position,
              categoryId: line.categoryId,
              cents: line.amountCents,
            })
            .run(),
        );
    }
  }
  writeMemberships(db, snapshot, facts);
  const state = {
    singleton: 1,
    startMonth: facts.startMonth,
    revision: preview.expectedRevision + 1,
    status: "active" as const,
    openingJson: JSON.stringify(facts.opening),
    coverageJson: JSON.stringify(preview.coverage),
    receiptJson: JSON.stringify({
      operationId: preview.operationId,
      revision: preview.expectedRevision + 1,
      reviewId: null,
    }),
    activatedAt: preview.recordedAt,
  };
  db.insert(budgetState)
    .values(state)
    .onConflictDoUpdate({ target: budgetState.singleton, set: state })
    .run();
}
function writeMemberships(
  db: BudgetQueries,
  snapshot: ReturnType<typeof budgetSnapshot>,
  facts: BudgetPreview["after"],
) {
  const consume = budgetSourceRows(snapshot);
  for (const event of facts.events)
    for (const sourceRowId of consume(event))
      db.insert(budgetSourceMemberships)
        .values({
          sourceRowId,
          eventId: event.kind === "transaction" ? event.id : null,
          transferId: event.kind === "transfer" ? event.id : null,
        })
        .run();
}
export function createBudgetStore(path: string, fault: (() => void) | null = null): BudgetStore {
  function run<T>(work: (session: BudgetSession) => T, write: boolean) {
    const c = openDatabase(path);
    try {
      const version = validateMigrationHistory(c.sqlite, migrationsFolder);
      if (version.applied !== version.latest)
        throw new Error("Database schema is out of date. Run db:migrate.");
      return c.db.transaction(
        (tx) =>
          work({
            snapshot: () => budgetSnapshot(tx),
            receipt: (operationId) => {
              const row = tx.select().from(changes).where(eq(changes.id, operationId)).get();
              if (!row || !row.operation.startsWith("budget.")) return null;
              const before = row.beforeJson === null ? null : JSON.parse(row.beforeJson);
              const revision = before?.revision ?? 0;
              if (!Number.isSafeInteger(revision)) throw new Error("Invalid budget receipt");
              return { revision: revision + 1, afterJson: row.afterJson };
            },
            save: (preview) => {
              const before = budgetSnapshot(tx);
              saveBudgetTransferLegs(tx, preview);
              writeFacts(tx, preview);
              fault?.();
              tx.insert(changes)
                .values({
                  id: preview.operationId,
                  operation: `budget.${preview.command.kind}`,
                  entityId: "budget",
                  beforeJson: JSON.stringify(before.state),
                  afterJson: JSON.stringify(preview.after),
                  recordedAt: preview.recordedAt,
                })
                .run();
            },
          }),
        { behavior: write ? "immediate" : "deferred" },
      );
    } finally {
      c.sqlite.close();
    }
  }
  return { read: (work) => run(work, false), write: (work) => run(work, true) };
}
