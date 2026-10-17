import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["cash", "credit", "tracking"] }).notNull(),
    currency: text("currency", { enum: ["USD"] }).notNull(),
    openingCents: integer("opening_cents"),
    openingDate: text("opening_date"),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("accounts_name", sql`length(trim(${table.name})) > 0`),
    check("accounts_kind", sql`${table.kind} IN ('cash', 'credit', 'tracking')`),
    check("accounts_currency", sql`${table.currency} = 'USD'`),
    check(
      "accounts_opening",
      sql`(${table.kind} = 'tracking' AND ${table.openingCents} IS NULL AND ${table.openingDate} IS NULL) OR (${table.kind} IN ('cash', 'credit') AND ${table.openingCents} IS NOT NULL AND ${table.openingDate} IS NOT NULL)`,
    ),
    check(
      "accounts_cents",
      sql`${table.openingCents} IS NULL OR (typeof(${table.openingCents}) = 'integer' AND ${table.openingCents} BETWEEN -9007199254740991 AND 9007199254740991)`,
    ),
    check(
      "accounts_revision",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
export type AccountRow = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;
