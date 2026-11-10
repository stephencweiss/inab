import { eq } from "drizzle-orm";
import { parseBudgetFacts } from "../budget/parse.js";
import { openDatabase } from "./database.js";
import { setupStatusFrom } from "./setup.js";
import { parseAccountRow, parseManualTransactionRow } from "./rows.js";
import { accounts } from "./schema/accounts.js";
import { transactions } from "./schema/transactions.js";
import { importRegisterRows, importLiveLinks } from "./schema/import-history.js";
import { budgetState } from "./schema/budget.js";
import { budgetCategories, budgetAssignments } from "./schema/categories.js";
import { budgetEvents, budgetAllocations } from "./schema/allocations.js";
import { budgetTransfers } from "./schema/transfers.js";
import type { BudgetSnapshot, BudgetCoverage, BudgetReceipt } from "../application/budget-ports.js";
import type { BudgetEvent } from "../budget/types.js";
export type BudgetQueries = Pick<
  ReturnType<typeof openDatabase>["db"],
  "select" | "insert" | "update" | "delete" | "all"
>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseBudgetCoverage(value: unknown): BudgetCoverage {
  if (
    !isRecord(value) ||
    typeof value.throughDate !== "string" ||
    typeof value.evidence !== "string" ||
    !Array.isArray(value.includedTransactionIds) ||
    !Array.isArray(value.postedBridgeEventIds) ||
    !value.includedTransactionIds.every((v) => typeof v === "string") ||
    !value.postedBridgeEventIds.every((v) => typeof v === "string")
  )
    throw new Error("Invalid budget coverage");
  return {
    throughDate: value.throughDate,
    evidence: value.evidence,
    includedTransactionIds: value.includedTransactionIds,
    postedBridgeEventIds: value.postedBridgeEventIds,
  };
}
function parseReceipt(value: unknown): BudgetReceipt {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    typeof value.revision !== "number" ||
    (value.reviewId !== null && typeof value.reviewId !== "string")
  )
    throw new Error("Invalid budget receipt");
  return { operationId: value.operationId, revision: value.revision, reviewId: value.reviewId };
}
function eventsFrom(db: BudgetQueries): BudgetEvent[] {
  const lines = db.select().from(budgetAllocations).orderBy(budgetAllocations.position).all();
  const events: BudgetEvent[] = db
    .select()
    .from(budgetEvents)
    .orderBy(budgetEvents.position, budgetEvents.id)
    .all()
    .map((row) => {
      const allocation =
        row.allocation === "categories"
          ? {
              kind: "categories" as const,
              lines: lines
                .filter((l) => l.eventId === row.id)
                .map((l) => ({ categoryId: l.categoryId, amountCents: l.cents })),
            }
          : { kind: row.allocation };
      return {
        kind: "transaction",
        id: row.id,
        sourceId: row.sourceId,
        date: row.date,
        order: row.position,
        accountId: row.accountId,
        amountCents: row.cents,
        allocation,
      };
    });
  for (const row of db.select().from(budgetTransfers).all())
    events.push({
      kind: "transfer",
      id: row.id,
      sourceId: row.sourceId,
      date: row.date,
      order: row.position,
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
      amountCents: row.cents,
      categoryId: row.categoryId,
    });
  return events.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function budgetSnapshot(db: BudgetQueries): BudgetSnapshot {
  const setup = setupStatusFrom(db);
  const storedAccounts = db.select().from(accounts).orderBy(accounts.id).all().map(parseAccountRow);
  const entries = db
    .select()
    .from(transactions)
    .orderBy(transactions.id)
    .all()
    .map(parseManualTransactionRow);
  const links = db.select().from(importLiveLinks).all();
  const sourceRows = db
    .select()
    .from(importRegisterRows)
    .orderBy(importRegisterRows.id)
    .all()
    .map((row) => ({
      id: row.id,
      accountId: row.accountId,
      date: row.occurredOn,
      cents: row.cents,
      role: row.role,
      transactionId: links.find((l) => l.sourceRowId === row.id)?.transactionId ?? null,
    }));
  const snapshot: BudgetSnapshot = {
    targetId: setup.targetId,
    setupState: setup.state,
    state: null,
    accounts: storedAccounts,
    transactions: entries,
    sourceRows,
  };
  const row = db.select().from(budgetState).where(eq(budgetState.singleton, 1)).get();
  if (!row) return snapshot;
  const categories = db
    .select()
    .from(budgetCategories)
    .orderBy(budgetCategories.position, budgetCategories.id)
    .all()
    .map((c) => ({
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      archived: c.archived,
      cardAccountId: c.cardAccountId,
    }));
  const assignments = db
    .select()
    .from(budgetAssignments)
    .orderBy(budgetAssignments.month, budgetAssignments.categoryId)
    .all()
    .map((a) => ({ month: a.month, categoryId: a.categoryId, amountCents: a.cents }));
  const events = eventsFrom(db),
    coverage = parseBudgetCoverage(JSON.parse(row.coverageJson));
  const base = parseBudgetFacts({
    startMonth: row.startMonth,
    currency: "USD",
    opening: JSON.parse(row.openingJson),
    categories,
    assignments,
    events,
  });
  if (!base.ok) throw new Error(`Invalid stored budget: ${base.reason}`);
  for (const tx of entries) {
    if (
      row.status === "needs-review" &&
      !base.value.opening.accounts.some((a) => a.accountId === tx.accountId)
    )
      continue;
    const covered = events.some(
      (e) => e.id === tx.id || (e.kind === "transfer" && e.sourceId.split("|").includes(tx.id)),
    );
    if (
      covered ||
      coverage.includedTransactionIds.includes(tx.id) ||
      tx.occurredOn < `${row.startMonth}-01`
    )
      continue;
    events.push({
      kind: "transaction",
      id: tx.id,
      sourceId: sourceRows.find((r) => r.transactionId === tx.id)?.id ?? `live:${tx.id}`,
      date: tx.occurredOn,
      order: events.length,
      accountId: tx.accountId,
      amountCents: tx.cents,
      allocation: { kind: "unallocated" },
    });
  }
  const parsed = parseBudgetFacts({
    startMonth: row.startMonth,
    currency: "USD",
    opening: base.value.opening,
    categories,
    assignments,
    events,
  });
  if (!parsed.ok) throw new Error(`Invalid stored budget: ${parsed.reason}`);
  snapshot.state = {
    facts: parsed.value,
    coverage,
    revision: row.revision,
    status: row.status,
    receipt: parseReceipt(JSON.parse(row.receiptJson)),
  };
  return snapshot;
}
