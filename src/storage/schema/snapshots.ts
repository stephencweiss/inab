import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    effectiveDate: text("effective_date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    source: text("source", { enum: ["manual"] }).notNull(),
    observedAt: text("observed_at").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    unique("snapshots_account_date").on(table.accountId, table.effectiveDate),
    check(
      "snapshots_cents",
      sql`typeof(${table.balanceCents}) = 'integer' AND ${table.balanceCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "snapshots_revision",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check("snapshots_source", sql`${table.source} = 'manual'`),
  ],
);
export type SnapshotRow = typeof snapshots.$inferSelect;
export type SnapshotInsert = typeof snapshots.$inferInsert;
