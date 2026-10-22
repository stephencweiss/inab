import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const setup = sqliteTable(
  "setup",
  {
    singleton: integer("singleton").primaryKey().notNull().default(1),
    targetId: text("target_id").notNull().unique(),
    revision: integer("revision").notNull(),
    state: text("state", { enum: ["open", "fresh", "ynab"] }).notNull(),
    completedAt: text("completed_at"),
    importId: text("import_id").unique(),
  },
  (t) => [
    check("setup_singleton", sql`${t.singleton} = 1`),
    check(
      "setup_revision",
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "setup_state",
      sql`(${t.state} = 'open' AND ${t.completedAt} IS NULL AND ${t.importId} IS NULL) OR (${t.state} = 'fresh' AND ${t.completedAt} IS NOT NULL AND ${t.importId} IS NULL) OR (${t.state} = 'ynab' AND ${t.completedAt} IS NOT NULL AND ${t.importId} IS NOT NULL)`,
    ),
  ],
);
export type SetupRow = typeof setup.$inferSelect;
