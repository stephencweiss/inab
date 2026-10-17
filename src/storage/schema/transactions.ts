import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    occurredOn: text("occurred_on").notNull(),
    postedOn: text("posted_on"),
    cents: integer("cents").notNull(),
    payee: text("payee").notNull(),
    memo: text("memo").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "transactions_cents",
      sql`typeof(${table.cents}) = 'integer' AND ${table.cents} BETWEEN -9007199254740991 AND 9007199254740991 AND ${table.cents} <> 0`,
    ),
    check(
      "transactions_revision",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;
