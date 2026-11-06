import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";

export const budgetGroups = sqliteTable(
  "budget_groups",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
  },
  (t) => [check("budget_group_name", sql`length(trim(${t.name})) > 0`)],
);
export const budgetCategories = sqliteTable(
  "budget_categories",
  {
    id: text("id").primaryKey().notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => budgetGroups.id),
    name: text("name").notNull(),
    archived: integer("archived", { mode: "boolean" }).notNull(),
    position: integer("position").notNull(),
    cardAccountId: text("card_account_id")
      .unique()
      .references(() => accounts.id),
  },
  (t) => [
    check("budget_category_name", sql`length(trim(${t.name})) > 0`),
    check("budget_category_archived", sql`${t.archived} IN (0,1)`),
    check(
      "budget_category_position",
      sql`typeof(${t.position}) = 'integer' AND ${t.position} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);
export const budgetAssignments = sqliteTable(
  "budget_assignments",
  {
    month: text("month").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => budgetCategories.id),
    cents: integer("cents").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.month, t.categoryId] }),
    check(
      "budget_assignment_month",
      sql`length(${t.month}) = 7 AND ${t.month} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(${t.month},6,2) BETWEEN '01' AND '12'`,
    ),
    check(
      "budget_assignment_cents",
      sql`typeof(${t.cents}) = 'integer' AND ${t.cents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
  ],
);
export type BudgetCategoryRow = typeof budgetCategories.$inferSelect;
