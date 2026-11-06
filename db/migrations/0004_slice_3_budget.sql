CREATE TABLE `budget_state` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`start_month` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`opening_json` text NOT NULL,
	`coverage_json` text NOT NULL,
	`receipt_json` text NOT NULL,
	`activated_at` text NOT NULL,
	CONSTRAINT "budget_singleton" CHECK("budget_state"."singleton" = 1),
	CONSTRAINT "budget_revision" CHECK(typeof("budget_state"."revision") = 'integer' AND "budget_state"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "budget_status" CHECK("budget_state"."status" IN ('active','needs-review')),
	CONSTRAINT "budget_month" CHECK(length("budget_state"."start_month") = 7 AND "budget_state"."start_month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr("budget_state"."start_month",6,2) BETWEEN '01' AND '12'),
	CONSTRAINT "budget_json" CHECK(json_valid("budget_state"."opening_json") AND json_valid("budget_state"."coverage_json") AND json_valid("budget_state"."receipt_json"))
);
--> statement-breakpoint
CREATE TABLE `budget_assignments` (
	`month` text NOT NULL,
	`category_id` text NOT NULL,
	`cents` integer NOT NULL,
	PRIMARY KEY(`month`, `category_id`),
	FOREIGN KEY (`category_id`) REFERENCES `budget_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_assignment_month" CHECK(length("budget_assignments"."month") = 7 AND "budget_assignments"."month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr("budget_assignments"."month",6,2) BETWEEN '01' AND '12'),
	CONSTRAINT "budget_assignment_cents" CHECK(typeof("budget_assignments"."cents") = 'integer' AND "budget_assignments"."cents" BETWEEN -9007199254740991 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `budget_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`archived` integer NOT NULL,
	`position` integer NOT NULL,
	`card_account_id` text,
	FOREIGN KEY (`group_id`) REFERENCES `budget_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_category_name" CHECK(length(trim("budget_categories"."name")) > 0),
	CONSTRAINT "budget_category_archived" CHECK("budget_categories"."archived" IN (0,1)),
	CONSTRAINT "budget_category_position" CHECK(typeof("budget_categories"."position") = 'integer' AND "budget_categories"."position" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_categories_card_account_id_unique` ON `budget_categories` (`card_account_id`);--> statement-breakpoint
CREATE TABLE `budget_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "budget_group_name" CHECK(length(trim("budget_groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `budget_allocations` (
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`category_id` text NOT NULL,
	`cents` integer NOT NULL,
	PRIMARY KEY(`event_id`, `position`),
	FOREIGN KEY (`event_id`) REFERENCES `budget_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `budget_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_allocation_cents" CHECK(typeof("budget_allocations"."cents") = 'integer' AND "budget_allocations"."cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "budget_allocation_position" CHECK(typeof("budget_allocations"."position") = 'integer' AND "budget_allocations"."position" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `budget_events` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`source_row_id` text,
	`source_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`position` integer NOT NULL,
	`cents` integer NOT NULL,
	`allocation` text NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_row_id`) REFERENCES `import_register_rows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_event_cents" CHECK(typeof("budget_events"."cents") = 'integer' AND "budget_events"."cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "budget_event_revision" CHECK(typeof("budget_events"."revision") = 'integer' AND "budget_events"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "budget_event_position" CHECK(typeof("budget_events"."position") = 'integer' AND "budget_events"."position" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "budget_event_allocation" CHECK("budget_events"."allocation" IN ('income','unallocated','categories'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_events_transaction_id_unique` ON `budget_events` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_events_source_row_id_unique` ON `budget_events` (`source_row_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_events_source_id_unique` ON `budget_events` (`source_id`);--> statement-breakpoint
CREATE TABLE `budget_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`from_account_id` text NOT NULL,
	`to_account_id` text NOT NULL,
	`from_transaction_id` text,
	`to_transaction_id` text,
	`date` text NOT NULL,
	`position` integer NOT NULL,
	`cents` integer NOT NULL,
	`category_id` text,
	`revision` integer NOT NULL,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `budget_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_transfer_accounts" CHECK("budget_transfers"."from_account_id" <> "budget_transfers"."to_account_id"),
	CONSTRAINT "budget_transfer_cents" CHECK(typeof("budget_transfers"."cents") = 'integer' AND "budget_transfers"."cents" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "budget_transfer_position" CHECK(typeof("budget_transfers"."position") = 'integer' AND "budget_transfers"."position" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "budget_transfer_revision" CHECK(typeof("budget_transfers"."revision") = 'integer' AND "budget_transfers"."revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_transfers_source_id_unique` ON `budget_transfers` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_transfers_from_transaction_id_unique` ON `budget_transfers` (`from_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_transfers_to_transaction_id_unique` ON `budget_transfers` (`to_transaction_id`);