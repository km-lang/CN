CREATE TABLE `coresignal_webhook_coverage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`alumnus_id` integer NOT NULL,
	`employee_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `coresignal_webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_coverage_subscription_employee` ON `coresignal_webhook_coverage` (`subscription_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_csw_coverage_alumnus` ON `coresignal_webhook_coverage` (`alumnus_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_csw_coverage_employee` ON `coresignal_webhook_coverage` (`employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `coresignal_webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`alumnus_id` integer,
	`employee_id` text NOT NULL,
	`change_type` text NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`provider_at` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`payload_digest` text NOT NULL,
	`dedupe_window` text NOT NULL,
	`status` text NOT NULL,
	`review_outcome` text DEFAULT '' NOT NULL,
	`collect_history_id` integer,
	FOREIGN KEY (`subscription_id`) REFERENCES `coresignal_webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collect_history_id`) REFERENCES `provider_response_history`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_event_dedupe` ON `coresignal_webhook_events` (`subscription_id`,`payload_digest`,`dedupe_window`);--> statement-breakpoint
CREATE INDEX `idx_csw_event_alumnus_date` ON `coresignal_webhook_events` (`alumnus_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_csw_event_status_date` ON `coresignal_webhook_events` (`status`,`received_at`);--> statement-breakpoint
CREATE TABLE `coresignal_webhook_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`employee_id` text NOT NULL,
	`namespace` text DEFAULT 'employee_base' NOT NULL,
	`status` text DEFAULT 'VERIFIED' NOT NULL,
	`evidence_reference` text NOT NULL,
	`verified_by` text NOT NULL,
	`verified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_identity_alumnus` ON `coresignal_webhook_identities` (`alumnus_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_identity_employee` ON `coresignal_webhook_identities` (`employee_id`);--> statement-breakpoint
CREATE TABLE `coresignal_webhook_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` integer NOT NULL,
	`action` text NOT NULL,
	`request_key` text NOT NULL,
	`actor` text NOT NULL,
	`status` text NOT NULL,
	`request_json` text DEFAULT '{}' NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `coresignal_webhook_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_operation_request` ON `coresignal_webhook_operations` (`request_key`);--> statement-breakpoint
CREATE INDEX `idx_csw_operation_subscription` ON `coresignal_webhook_operations` (`subscription_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `coresignal_webhook_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cohort_type` text NOT NULL,
	`selection_json` text NOT NULL,
	`selection_version` text NOT NULL,
	`membership_json` text NOT NULL,
	`provider_subscription_id` text DEFAULT '' NOT NULL,
	`provider_mode` text DEFAULT 'mock' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`activated_at` text DEFAULT '' NOT NULL,
	`expires_at` text DEFAULT '' NOT NULL,
	`last_reconciled_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_csw_provider_subscription` ON `coresignal_webhook_subscriptions` (`provider_subscription_id`) WHERE "coresignal_webhook_subscriptions"."provider_subscription_id" != '';--> statement-breakpoint
CREATE INDEX `idx_csw_status_expiry` ON `coresignal_webhook_subscriptions` (`status`,`expires_at`);