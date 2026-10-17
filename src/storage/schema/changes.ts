import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const changes = sqliteTable("changes", {
  id: text("id").primaryKey().notNull(),
  operation: text("operation").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json").notNull(),
  recordedAt: text("recorded_at").notNull(),
});
export type ChangeRow = typeof changes.$inferSelect;
export type ChangeInsert = typeof changes.$inferInsert;
