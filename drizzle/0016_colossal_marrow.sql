CREATE TABLE `mutation_commit_guards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_key` text NOT NULL,
	`alumnus_id` integer NOT NULL,
	`operation` text NOT NULL,
	`valid` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_key`) REFERENCES `mutation_requests`(`request_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mutation_commit_guard_valid_check" CHECK("mutation_commit_guards"."valid" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mutation_commit_guard_request_alumnus` ON `mutation_commit_guards` (`request_key`,`alumnus_id`,`operation`);--> statement-breakpoint
CREATE TABLE `mutation_request_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_key` text NOT NULL,
	`item_key` text NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`outcome_json` text DEFAULT '{}' NOT NULL,
	`completed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_key`) REFERENCES `mutation_requests`(`request_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mutation_request_item_status_check" CHECK("mutation_request_items"."status" in ('COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mutation_request_item_unique` ON `mutation_request_items` (`request_key`,`item_key`);--> statement-breakpoint
CREATE INDEX `idx_mutation_request_item_request` ON `mutation_request_items` (`request_key`);--> statement-breakpoint
CREATE TABLE `mutation_requests` (
	`request_key` text PRIMARY KEY NOT NULL,
	`client_key_hash` text NOT NULL,
	`actor_user_id` integer NOT NULL,
	`operation_type` text NOT NULL,
	`target_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'IN_PROGRESS' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`lease_expires_at` text DEFAULT '' NOT NULL,
	`http_status` integer DEFAULT 0 NOT NULL,
	`response_json` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mutation_request_status_check" CHECK("mutation_requests"."status" in ('IN_PROGRESS', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mutation_request_client_scope` ON `mutation_requests` (`actor_user_id`,`operation_type`,`target_key`,`client_key_hash`);--> statement-breakpoint
CREATE INDEX `idx_mutation_request_status_lease` ON `mutation_requests` (`status`,`lease_expires_at`);--> statement-breakpoint
ALTER TABLE `activity_log` ADD `mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_log_mutation` ON `activity_log` (`mutation_request_key`) WHERE "activity_log"."mutation_request_key" != '';--> statement-breakpoint
ALTER TABLE `alumni` ADD `last_mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni_profile_change_proposals` ADD `mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni_profile_change_proposals` ADD `decision_mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profile_change_proposal_mutation_field` ON `alumni_profile_change_proposals` (`mutation_request_key`,`field`) WHERE "alumni_profile_change_proposals"."mutation_request_key" != '';--> statement-breakpoint
ALTER TABLE `field_change_history` ADD `mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_field_change_mutation_field` ON `field_change_history` (`mutation_request_key`,`field`) WHERE "field_change_history"."mutation_request_key" != '';--> statement-breakpoint
ALTER TABLE `import_runs` ADD `mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_import_run_mutation` ON `import_runs` (`mutation_request_key`) WHERE "import_runs"."mutation_request_key" != '';--> statement-breakpoint
ALTER TABLE `security_audit_events` ADD `mutation_request_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_security_audit_mutation` ON `security_audit_events` (`mutation_request_key`) WHERE "security_audit_events"."mutation_request_key" != '';