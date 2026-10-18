CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`opening_cents` integer,
	`opening_date` text,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "accounts_name" CHECK(length(trim("accounts"."name")) > 0),
	CONSTRAINT "accounts_kind" CHECK("accounts"."kind" IN ('cash', 'credit', 'tracking')),
	CONSTRAINT "accounts_currency" CHECK("accounts"."currency" = 'USD'),
	CONSTRAINT "accounts_opening" CHECK(("accounts"."kind" = 'tracking' AND "accounts"."opening_cents" IS NULL AND "accounts"."opening_date" IS NULL) OR ("accounts"."kind" IN ('cash', 'credit') AND "accounts"."opening_cents" IS NOT NULL AND "accounts"."opening_date" IS NOT NULL)),
	CONSTRAINT "accounts_cents" CHECK("accounts"."opening_cents" IS NULL OR (typeof("accounts"."opening_cents") = 'integer' AND "accounts"."opening_cents" BETWEEN -9007199254740991 AND 9007199254740991)),
	CONSTRAINT "accounts_revision" CHECK(typeof("accounts"."revision") = 'integer' AND "accounts"."revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`posted_on` text,
	`cents` integer NOT NULL,
	`payee` text NOT NULL,
	`memo` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_cents" CHECK(typeof("transactions"."cents") = 'integer' AND "transactions"."cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "transactions"."cents" <> 0),
	CONSTRAINT "transactions_revision" CHECK(typeof("transactions"."revision") = 'integer' AND "transactions"."revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_entries` (
	`reconciliation_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`transaction_revision` integer NOT NULL,
	`cents` integer NOT NULL,
	`posted_on` text NOT NULL,
	PRIMARY KEY(`reconciliation_id`, `transaction_id`),
	FOREIGN KEY (`reconciliation_id`) REFERENCES `reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reconciliation_entries_cents" CHECK(typeof("reconciliation_entries"."cents") = 'integer' AND "reconciliation_entries"."cents" BETWEEN -9007199254740991 AND 9007199254740991 AND "reconciliation_entries"."cents" <> 0),
	CONSTRAINT "reconciliation_entries_revision" CHECK(typeof("reconciliation_entries"."transaction_revision") = 'integer' AND "reconciliation_entries"."transaction_revision" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`cutoff_date` text NOT NULL,
	`bank_cents` integer NOT NULL,
	`computed_cents` integer NOT NULL,
	`opening_cents` integer NOT NULL,
	`opening_date` text NOT NULL,
	`account_revision` integer NOT NULL,
	`status` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reconciliations_bank" CHECK(typeof("reconciliations"."bank_cents") = 'integer' AND "reconciliations"."bank_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "reconciliations_computed" CHECK(typeof("reconciliations"."computed_cents") = 'integer' AND "reconciliations"."computed_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "reconciliations_opening" CHECK(typeof("reconciliations"."opening_cents") = 'integer' AND "reconciliations"."opening_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "reconciliations_revision" CHECK(typeof("reconciliations"."account_revision") = 'integer' AND "reconciliations"."account_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "reconciliations_status" CHECK("reconciliations"."status" IN ('valid', 'needs-review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliations_confirmation` ON `reconciliations` (`account_id`,`cutoff_date`,`account_revision`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`source` text NOT NULL,
	`observed_at` text NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "snapshots_cents" CHECK(typeof("snapshots"."balance_cents") = 'integer' AND "snapshots"."balance_cents" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "snapshots_revision" CHECK(typeof("snapshots"."revision") = 'integer' AND "snapshots"."revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "snapshots_source" CHECK("snapshots"."source" = 'manual')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_account_date` ON `snapshots` (`account_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `changes` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`recorded_at` text NOT NULL
);
