CREATE TABLE `budget_source_memberships` (
	`source_row_id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`transfer_id` text,
	FOREIGN KEY (`source_row_id`) REFERENCES `import_register_rows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `budget_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_id`) REFERENCES `budget_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_source_owner" CHECK(("budget_source_memberships"."event_id" IS NOT NULL AND "budget_source_memberships"."transfer_id" IS NULL) OR ("budget_source_memberships"."event_id" IS NULL AND "budget_source_memberships"."transfer_id" IS NOT NULL))
);
