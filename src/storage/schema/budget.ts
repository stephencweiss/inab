import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const budgetState = sqliteTable(
  "budget_state",
  {
    singleton: integer("singleton").primaryKey().notNull(),
    startMonth: text("start_month").notNull(),
    revision: integer("revision").notNull(),
    status: text("status", { enum: ["active", "needs-review"] }).notNull(),
    openingJson: text("opening_json").notNull(),
    coverageJson: text("coverage_json").notNull(),
    receiptJson: text("receipt_json").notNull(),
    activatedAt: text("activated_at").notNull(),
  },
  (t) => [
    check("budget_singleton", sql`${t.singleton} = 1`),
    check(
      "budget_revision",
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} BETWEEN 1 AND 9007199254740991`,
    ),
    check("budget_status", sql`${t.status} IN ('active','needs-review')`),
    check(
      "budget_month",
      sql`length(${t.startMonth}) = 7 AND ${t.startMonth} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(${t.startMonth},6,2) BETWEEN '01' AND '12'`,
    ),
    check(
      "budget_json",
      sql`json_valid(${t.openingJson}) AND json_valid(${t.coverageJson}) AND json_valid(${t.receiptJson})`,
    ),
  ],
);
export type BudgetStateRow = typeof budgetState.$inferSelect;
