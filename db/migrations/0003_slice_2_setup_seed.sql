INSERT INTO setup (singleton,target_id,revision,state,completed_at,import_id)
SELECT 1, lower(hex(randomblob(16))), 1,
 CASE WHEN EXISTS (SELECT 1 FROM accounts) OR EXISTS (SELECT 1 FROM transactions) OR EXISTS (SELECT 1 FROM reconciliations) OR EXISTS (SELECT 1 FROM reconciliation_entries) OR EXISTS (SELECT 1 FROM snapshots) OR EXISTS (SELECT 1 FROM changes) OR EXISTS (SELECT 1 FROM import_runs) OR EXISTS (SELECT 1 FROM import_sources) OR EXISTS (SELECT 1 FROM import_account_mappings) OR EXISTS (SELECT 1 FROM import_register_rows) OR EXISTS (SELECT 1 FROM import_plan_rows) OR EXISTS (SELECT 1 FROM import_live_links) OR EXISTS (SELECT 1 FROM import_observations) THEN 'fresh' ELSE 'open' END,
 CASE WHEN EXISTS (SELECT 1 FROM accounts) OR EXISTS (SELECT 1 FROM transactions) OR EXISTS (SELECT 1 FROM reconciliations) OR EXISTS (SELECT 1 FROM reconciliation_entries) OR EXISTS (SELECT 1 FROM snapshots) OR EXISTS (SELECT 1 FROM changes) OR EXISTS (SELECT 1 FROM import_runs) OR EXISTS (SELECT 1 FROM import_sources) OR EXISTS (SELECT 1 FROM import_account_mappings) OR EXISTS (SELECT 1 FROM import_register_rows) OR EXISTS (SELECT 1 FROM import_plan_rows) OR EXISTS (SELECT 1 FROM import_live_links) OR EXISTS (SELECT 1 FROM import_observations) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
 NULL;
--> statement-breakpoint
CREATE TRIGGER import_sources_immutable_update BEFORE UPDATE ON import_sources
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_sources_immutable_delete BEFORE DELETE ON import_sources
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_register_rows_immutable_update BEFORE UPDATE ON import_register_rows
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_register_rows_immutable_delete BEFORE DELETE ON import_register_rows
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_plan_rows_immutable_update BEFORE UPDATE ON import_plan_rows
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_plan_rows_immutable_delete BEFORE DELETE ON import_plan_rows
BEGIN SELECT RAISE(ABORT, 'Original import evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_register_rows_source_guard BEFORE INSERT ON import_register_rows
WHEN NOT EXISTS (SELECT 1 FROM import_sources WHERE id = NEW.source_id AND import_id = NEW.import_id AND role = 'register')
BEGIN SELECT RAISE(ABORT, 'Import source relationship mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER import_plan_rows_source_guard BEFORE INSERT ON import_plan_rows
WHEN NOT EXISTS (SELECT 1 FROM import_sources WHERE id = NEW.source_id AND import_id = NEW.import_id AND role = 'plan')
BEGIN SELECT RAISE(ABORT, 'Import source relationship mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER import_observations_guard_insert BEFORE INSERT ON import_observations
WHEN NOT EXISTS (SELECT 1 FROM import_register_rows r JOIN accounts a ON a.id = r.account_id WHERE r.id = NEW.source_row_id AND r.account_id = NEW.account_id AND r.import_id = NEW.import_id AND r.role = 'adjustment' AND a.kind = 'tracking')
BEGIN SELECT RAISE(ABORT, 'Observation source relationship mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER import_observations_guard_update BEFORE UPDATE ON import_observations
WHEN NOT EXISTS (SELECT 1 FROM import_register_rows r JOIN accounts a ON a.id = r.account_id WHERE r.id = NEW.source_row_id AND r.account_id = NEW.account_id AND r.import_id = NEW.import_id AND r.role = 'adjustment' AND a.kind = 'tracking')
BEGIN SELECT RAISE(ABORT, 'Observation source relationship mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER import_live_links_guard BEFORE INSERT ON import_live_links
WHEN NOT EXISTS (SELECT 1 FROM import_register_rows r JOIN transactions t ON t.account_id = r.account_id WHERE r.id = NEW.source_row_id AND t.id = NEW.transaction_id AND r.disposition = 'live-linked' AND t.cents = r.cents)
BEGIN SELECT RAISE(ABORT, 'Live source relationship mismatch'); END;
