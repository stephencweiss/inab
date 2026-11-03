import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
import { transactions } from "./transactions.js";
import { importRuns, importSources } from "./import-sources.js";
export const importAccountMappings = sqliteTable(
  "import_account_mappings",
  {
    id: text("id").primaryKey().notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => importRuns.id),
    sourceLabel: text("source_label").notNull(),
    groupKey: text("group_key").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    closed: integer("closed", { mode: "boolean" }).notNull(),
  },
  (t) => [
    unique("import_mapping_group").on(t.importId, t.groupKey),
    unique("import_mapping_account").on(t.accountId),
    check("import_mapping_closed", sql`${t.closed} IN (0,1)`),
  ],
);
export const importRegisterRows = sqliteTable(
  "import_register_rows",
  {
    id: text("id").primaryKey().notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => importRuns.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => importSources.id),
    ordinal: integer("ordinal").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    occurredOn: text("occurred_on").notNull(),
    cents: integer("cents").notNull(),
    postedOn: text("posted_on"),
    treatment: text("treatment", { enum: ["history", "pending", "posted"] }).notNull(),
    role: text("role", { enum: ["transaction", "adjustment", "opening"] }).notNull(),
    disposition: text("disposition", {
      enum: ["history-only", "live-linked", "observation-evidence"],
    }).notNull(),
    originalJson: text("original_json").notNull(),
    normalizedJson: text("normalized_json").notNull(),
  },
  (t) => [
    unique("import_register_ordinal").on(t.sourceId, t.ordinal),
    check(
      "import_register_ordinal_positive",
      sql`typeof(${t.ordinal}) = 'integer' AND ${t.ordinal} BETWEEN 1 AND 250000`,
    ),
    check(
      "import_register_cents",
      sql`typeof(${t.cents}) = 'integer' AND ${t.cents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check("import_register_treatment", sql`${t.treatment} IN ('history','pending','posted')`),
    check(
      "import_register_posting",
      sql`(${t.treatment} = 'posted' AND ${t.postedOn} IS NOT NULL) OR (${t.treatment} <> 'posted' AND ${t.postedOn} IS NULL)`,
    ),
    check("import_register_role", sql`${t.role} IN ('transaction','adjustment','opening')`),
    check(
      "import_register_disposition",
      sql`${t.disposition} IN ('history-only','live-linked','observation-evidence')`,
    ),
    check(
      "import_register_json",
      sql`json_valid(${t.originalJson}) AND json_valid(${t.normalizedJson})`,
    ),
  ],
);
export const importPlanRows = sqliteTable(
  "import_plan_rows",
  {
    id: text("id").primaryKey().notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => importRuns.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => importSources.id),
    ordinal: integer("ordinal").notNull(),
    month: text("month").notNull(),
    group: text("group_name").notNull(),
    category: text("category").notNull(),
    assignedCents: integer("assigned_cents").notNull(),
    activityCents: integer("activity_cents").notNull(),
    availableCents: integer("available_cents").notNull(),
    disposition: text("disposition", { enum: ["history-only"] }).notNull(),
    originalJson: text("original_json").notNull(),
    normalizedJson: text("normalized_json").notNull(),
  },
  (t) => [
    unique("import_plan_ordinal").on(t.sourceId, t.ordinal),
    check(
      "import_plan_ordinal_positive",
      sql`typeof(${t.ordinal}) = 'integer' AND ${t.ordinal} BETWEEN 1 AND 250000`,
    ),
    check(
      "import_plan_assigned",
      sql`typeof(${t.assignedCents}) = 'integer' AND ${t.assignedCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "import_plan_activity",
      sql`typeof(${t.activityCents}) = 'integer' AND ${t.activityCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "import_plan_available",
      sql`typeof(${t.availableCents}) = 'integer' AND ${t.availableCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check("import_plan_disposition", sql`${t.disposition} = 'history-only'`),
    check(
      "import_plan_json",
      sql`json_valid(${t.originalJson}) AND json_valid(${t.normalizedJson})`,
    ),
  ],
);
export const importLiveLinks = sqliteTable("import_live_links", {
  sourceRowId: text("source_row_id")
    .primaryKey()
    .notNull()
    .references(() => importRegisterRows.id),
  transactionId: text("transaction_id")
    .notNull()
    .unique()
    .references(() => transactions.id),
});
export type ImportAccountMappingRow = typeof importAccountMappings.$inferSelect;
export type ImportAccountMappingInsert = typeof importAccountMappings.$inferInsert;
export type ImportRegisterRow = typeof importRegisterRows.$inferSelect;
export type ImportRegisterInsert = typeof importRegisterRows.$inferInsert;
export type ImportPlanRow = typeof importPlanRows.$inferSelect;
export type ImportPlanInsert = typeof importPlanRows.$inferInsert;
export type ImportLiveLinkRow = typeof importLiveLinks.$inferSelect;
export type ImportLiveLinkInsert = typeof importLiveLinks.$inferInsert;
