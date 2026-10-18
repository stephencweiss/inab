import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
import { transactions } from "./transactions.js";
export const reconciliations = sqliteTable(
  "reconciliations",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    cutoffDate: text("cutoff_date").notNull(),
    bankCents: integer("bank_cents").notNull(),
    computedCents: integer("computed_cents").notNull(),
    openingCents: integer("opening_cents").notNull(),
    openingDate: text("opening_date").notNull(),
    accountRevision: integer("account_revision").notNull(),
    status: text("status", { enum: ["valid", "needs-review"] }).notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    unique("reconciliations_confirmation").on(
      table.accountId,
      table.cutoffDate,
      table.accountRevision,
    ),
    check(
      "reconciliations_bank",
      sql`typeof(${table.bankCents}) = 'integer' AND ${table.bankCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "reconciliations_computed",
      sql`typeof(${table.computedCents}) = 'integer' AND ${table.computedCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "reconciliations_opening",
      sql`typeof(${table.openingCents}) = 'integer' AND ${table.openingCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "reconciliations_revision",
      sql`typeof(${table.accountRevision}) = 'integer' AND ${table.accountRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check("reconciliations_status", sql`${table.status} IN ('valid', 'needs-review')`),
  ],
);
export const reconciliationEntries = sqliteTable(
  "reconciliation_entries",
  {
    reconciliationId: text("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    transactionRevision: integer("transaction_revision").notNull(),
    cents: integer("cents").notNull(),
    postedOn: text("posted_on").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.reconciliationId, table.transactionId] }),
    check(
      "reconciliation_entries_cents",
      sql`typeof(${table.cents}) = 'integer' AND ${table.cents} BETWEEN -9007199254740991 AND 9007199254740991 AND ${table.cents} <> 0`,
    ),
    check(
      "reconciliation_entries_revision",
      sql`typeof(${table.transactionRevision}) = 'integer' AND ${table.transactionRevision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
export type ReconciliationRow = typeof reconciliations.$inferSelect;
export type ReconciliationInsert = typeof reconciliations.$inferInsert;
export type ReconciliationEntryRow = typeof reconciliationEntries.$inferSelect;
export type ReconciliationEntryInsert = typeof reconciliationEntries.$inferInsert;
