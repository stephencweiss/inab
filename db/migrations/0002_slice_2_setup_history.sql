CREATE TABLE `setup` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`completed_at` text,
	`import_id` text,
	CONSTRAINT "setup_singleton" CHECK("setup"."singleton" = 1),
	CONSTRAINT "setup_revision" CHECK(typeof("setup"."revision") = 'integer' AND "setup"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "setup_state" CHECK(("setup"."state" = 'open' AND "setup"."completed_at" IS NULL AND "setup"."import_id" IS NULL) OR ("setup"."state" = 'fresh' AND "setup"."completed_at" IS NOT NULL AND "setup"."import_id" IS NULL) OR ("setup"."state" = 'ynab' AND "setup"."completed_at" IS NOT NULL AND "setup"."import_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_target_id_unique` ON `setup` (`target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `setup_import_id_unique` ON `setup` (`import_id`);--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`review_revision` integer NOT NULL,
	`completed_at` text NOT NULL,
	`receipt_json` text NOT NULL,
	CONSTRAINT "import_runs_revision" CHECK(typeof("import_runs"."review_revision") = 'integer' AND "import_runs"."review_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "import_runs_receipt" CHECK(json_valid("import_runs"."receipt_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_runs_review` ON `import_runs` (`review_id`,`review_revision`);--> statement-breakpoint
CREATE TABLE `import_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`role` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` blob NOT NULL,
	`byte_length` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_sources_role" CHECK("import_sources"."role" IN ('register','plan')),
	CONSTRAINT "import_sources_bytes" CHECK(typeof("import_sources"."byte_length") = 'integer' AND "import_sources"."byte_length" BETWEEN 0 AND 67108864 AND length("import_sources"."bytes") = "import_sources"."byte_length"),
	CONSTRAINT "import_sources_hash" CHECK(length("import_sources"."sha256") = 64 AND "import_sources"."sha256" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_sources_digest` ON `import_sources` (`role`,`sha256`);--> statement-breakpoint
CREATE TABLE `import_account_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`source_label` text NOT NULL,
	`group_key` text NOT NULL,
	`account_id` text NOT NULL,
	`closed` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_mapping_closed" CHECK("import_account_mappings"."closed" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_mapping_group` ON `import_account_mappings` (`import_id`,`group_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_mapping_account` ON `import_account_mappings` (`account_id`);--> statement-breakpoint
CREATE TABLE `import_live_links` (
	`source_row_id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	FOREIGN KEY (`source_row_id`) REFERENCES `import_register_rows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_live_links_transaction_id_unique` ON `import_live_links` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `import_plan_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`source_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`month` text NOT NULL,
	`group_name` text NOT NULL,
	`category` text NOT NULL,
	`assigned_cents` integer NOT NULL,
	`activity_cents` integer NOT NULL,
	`available_cents` integer NOT NULL,
	`disposition` text NOT NULL,
	`original_json` text NOT NULL,
	`normalized_json` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `import_sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_plan_ordinal_positive" CHECK(typeof("import_plan_rows"."ordinal") = 'integer' AND "import_plan_rows"."ordinal" BETWEEN 1 AND 250000),
	CONSTRAINT "import_plan_assigned" CHECK(typeof("import_plan_rows"."assigned_cents") = 'integer' AND "import_plan_rows"."assigned_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_plan_activity" CHECK(typeof("import_plan_rows"."activity_cents") = 'integer' AND "import_plan_rows"."activity_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_plan_available" CHECK(typeof("import_plan_rows"."available_cents") = 'integer' AND "import_plan_rows"."available_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_plan_disposition" CHECK("import_plan_rows"."disposition" = 'history-only'),
	CONSTRAINT "import_plan_json" CHECK(json_valid("import_plan_rows"."original_json") AND json_valid("import_plan_rows"."normalized_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_plan_ordinal` ON `import_plan_rows` (`source_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `import_register_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`source_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`account_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`cents` integer NOT NULL,
	`posted_on` text,
	`treatment` text NOT NULL,
	`role` text NOT NULL,
	`disposition` text NOT NULL,
	`original_json` text NOT NULL,
	`normalized_json` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `import_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_register_ordinal_positive" CHECK(typeof("import_register_rows"."ordinal") = 'integer' AND "import_register_rows"."ordinal" BETWEEN 1 AND 250000),
	CONSTRAINT "import_register_cents" CHECK(typeof("import_register_rows"."cents") = 'integer' AND "import_register_rows"."cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_register_treatment" CHECK("import_register_rows"."treatment" IN ('history','pending','posted')),
	CONSTRAINT "import_register_posting" CHECK(("import_register_rows"."treatment" = 'posted' AND "import_register_rows"."posted_on" IS NOT NULL) OR ("import_register_rows"."treatment" <> 'posted' AND "import_register_rows"."posted_on" IS NULL)),
	CONSTRAINT "import_register_role" CHECK("import_register_rows"."role" IN ('transaction','adjustment','opening')),
	CONSTRAINT "import_register_disposition" CHECK("import_register_rows"."disposition" IN ('history-only','live-linked','observation-evidence')),
	CONSTRAINT "import_register_json" CHECK(json_valid("import_register_rows"."original_json") AND json_valid("import_register_rows"."normalized_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_register_ordinal` ON `import_register_rows` (`source_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `import_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source_row_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`observed_cents` integer NOT NULL,
	`original_adjustment_cents` integer NOT NULL,
	`current_adjustment_cents` integer,
	`state` text NOT NULL,
	`metadata_json` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_row_id`) REFERENCES `import_register_rows`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_observations_observed" CHECK(typeof("import_observations"."observed_cents") = 'integer' AND "import_observations"."observed_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_observations_original" CHECK(typeof("import_observations"."original_adjustment_cents") = 'integer' AND "import_observations"."original_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "import_observations_current" CHECK("import_observations"."current_adjustment_cents" IS NULL OR (typeof("import_observations"."current_adjustment_cents") = 'integer' AND "import_observations"."current_adjustment_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "import_observations_state" CHECK("import_observations"."state" IN ('verified','needs-review','unverified')),
	CONSTRAINT "import_observations_json" CHECK(json_valid("import_observations"."metadata_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_observations_source_row_id_unique` ON `import_observations` (`source_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_observations_account_date` ON `import_observations` (`account_id`,`effective_date`);