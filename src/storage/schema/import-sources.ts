import { sql } from "drizzle-orm";
import { blob, check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
export const importRuns = sqliteTable(
  "import_runs",
  {
    id: text("id").primaryKey().notNull(),
    reviewId: text("review_id").notNull(),
    reviewRevision: integer("review_revision").notNull(),
    completedAt: text("completed_at").notNull(),
    receiptJson: text("receipt_json").notNull(),
  },
  (t) => [
    unique("import_runs_review").on(t.reviewId, t.reviewRevision),
    check(
      "import_runs_revision",
      sql`typeof(${t.reviewRevision}) = 'integer' AND ${t.reviewRevision} BETWEEN 1 AND 9007199254740991`,
    ),
    check("import_runs_receipt", sql`json_valid(${t.receiptJson})`),
  ],
);
export const importSources = sqliteTable(
  "import_sources",
  {
    id: text("id").primaryKey().notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => importRuns.id),
    role: text("role", { enum: ["register", "plan"] }).notNull(),
    sha256: text("sha256").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    byteLength: integer("byte_length").notNull(),
  },
  (t) => [
    unique("import_sources_digest").on(t.role, t.sha256),
    check("import_sources_role", sql`${t.role} IN ('register','plan')`),
    check(
      "import_sources_bytes",
      sql`typeof(${t.byteLength}) = 'integer' AND ${t.byteLength} BETWEEN 0 AND 67108864 AND length(${t.bytes}) = ${t.byteLength}`,
    ),
    check(
      "import_sources_hash",
      sql`length(${t.sha256}) = 64 AND ${t.sha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);
export type ImportRunRow = typeof importRuns.$inferSelect;
export type ImportRunInsert = typeof importRuns.$inferInsert;
export type ImportSourceRow = typeof importSources.$inferSelect;
export type ImportSourceInsert = typeof importSources.$inferInsert;
