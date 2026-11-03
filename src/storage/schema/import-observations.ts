import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.js";
import { importRuns } from "./import-sources.js";
import { importRegisterRows } from "./import-history.js";
export const importObservations = sqliteTable(
  "import_observations",
  {
    id: text("id").primaryKey().notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => importRuns.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    sourceRowId: text("source_row_id")
      .notNull()
      .unique()
      .references(() => importRegisterRows.id),
    effectiveDate: text("effective_date").notNull(),
    observedCents: integer("observed_cents").notNull(),
    originalAdjustmentCents: integer("original_adjustment_cents").notNull(),
    currentAdjustmentCents: integer("current_adjustment_cents"),
    state: text("state", { enum: ["verified", "needs-review", "unverified"] }).notNull(),
    metadataJson: text("metadata_json").notNull(),
  },
  (t) => [
    unique("import_observations_account_date").on(t.accountId, t.effectiveDate),
    check(
      "import_observations_observed",
      sql`typeof(${t.observedCents}) = 'integer' AND ${t.observedCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "import_observations_original",
      sql`typeof(${t.originalAdjustmentCents}) = 'integer' AND ${t.originalAdjustmentCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      "import_observations_current",
      sql`${t.currentAdjustmentCents} IS NULL OR (typeof(${t.currentAdjustmentCents}) = 'integer' AND ${t.currentAdjustmentCents} BETWEEN -9007199254740991 AND 9007199254740991)`,
    ),
    check("import_observations_state", sql`${t.state} IN ('verified','needs-review','unverified')`),
    check("import_observations_json", sql`json_valid(${t.metadataJson})`),
  ],
);
export type ImportObservationRow = typeof importObservations.$inferSelect;
export type ImportObservationInsert = typeof importObservations.$inferInsert;
