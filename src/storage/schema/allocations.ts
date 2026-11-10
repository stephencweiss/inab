import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
import { transactions } from "./transactions.js";
import { importRegisterRows } from "./import-history.js";
import { budgetCategories } from "./categories.js";
import { budgetTransfers } from "./transfers.js";

export const budgetEvents = sqliteTable(
  "budget_events",
  {
    id: text("id").primaryKey().notNull(),
    transactionId: text("transaction_id")
      .unique()
      .references(() => transactions.id),
    sourceRowId: text("source_row_id")
      .unique()
      .references(() => importRegisterRows.id),
    sourceId: text("source_id").notNull().unique(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    date: text("date").notNull(),
    position: integer("position").notNull(),
    cents: integer("cents").notNull(),
    allocation: text("allocation", { enum: ["income", "unallocated", "categories"] }).notNull(),
    revision: integer("revision").notNull(),
  },
  (t) => [
    check(
      "budget_event_cents",
      sql`typeof(${t.cents}) = 'integer' AND ${t.cents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "budget_event_revision",
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "budget_event_position",
      sql`typeof(${t.position}) = 'integer' AND ${t.position} BETWEEN 0 AND 9007199254740991`,
    ),
    check("budget_event_allocation", sql`${t.allocation} IN ('income','unallocated','categories')`),
  ],
);
export const budgetAllocations = sqliteTable(
  "budget_allocations",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => budgetEvents.id),
    position: integer("position").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => budgetCategories.id),
    cents: integer("cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.position] }),
    check(
      "budget_allocation_cents",
      sql`typeof(${t.cents}) = 'integer' AND ${t.cents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "budget_allocation_position",
      sql`typeof(${t.position}) = 'integer' AND ${t.position} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);
export const budgetSourceMemberships = sqliteTable(
  "budget_source_memberships",
  {
    sourceRowId: text("source_row_id")
      .primaryKey()
      .notNull()
      .references(() => importRegisterRows.id),
    eventId: text("event_id").references(() => budgetEvents.id),
    transferId: text("transfer_id").references(() => budgetTransfers.id),
  },
  (t) => [
    check(
      "budget_source_owner",
      sql`(${t.eventId} IS NOT NULL AND ${t.transferId} IS NULL) OR (${t.eventId} IS NULL AND ${t.transferId} IS NOT NULL)`,
    ),
  ],
);
