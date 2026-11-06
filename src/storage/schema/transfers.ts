import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
import { transactions } from "./transactions.js";
import { budgetCategories } from "./categories.js";

export const budgetTransfers = sqliteTable(
  "budget_transfers",
  {
    id: text("id").primaryKey().notNull(),
    sourceId: text("source_id").notNull().unique(),
    fromAccountId: text("from_account_id")
      .notNull()
      .references(() => accounts.id),
    toAccountId: text("to_account_id")
      .notNull()
      .references(() => accounts.id),
    fromTransactionId: text("from_transaction_id")
      .unique()
      .references(() => transactions.id),
    toTransactionId: text("to_transaction_id")
      .unique()
      .references(() => transactions.id),
    date: text("date").notNull(),
    position: integer("position").notNull(),
    cents: integer("cents").notNull(),
    categoryId: text("category_id").references(() => budgetCategories.id),
    revision: integer("revision").notNull(),
  },
  (t) => [
    check("budget_transfer_accounts", sql`${t.fromAccountId} <> ${t.toAccountId}`),
    check(
      "budget_transfer_cents",
      sql`typeof(${t.cents}) = 'integer' AND ${t.cents} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "budget_transfer_position",
      sql`typeof(${t.position}) = 'integer' AND ${t.position} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "budget_transfer_revision",
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
