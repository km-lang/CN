CREATE TABLE `external_discovery_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`provider` text DEFAULT 'pdl' NOT NULL,
	`provider_result_id` text NOT NULL,
	`name` text NOT NULL,
	`education` text NOT NULL,
	`current_company` text NOT NULL,
	`role` text NOT NULL,
	`raw_title` text DEFAULT '' NOT NULL,
	`function` text NOT NULL,
	`seniority` text NOT NULL,
	`location` text NOT NULL,
	`graduation_year` integer DEFAULT 0 NOT NULL,
	`linkedin_url` text DEFAULT '' NOT NULL,
	`provider_person_id` text DEFAULT '' NOT NULL,
	`match_status` text NOT NULL,
	`match_confidence` integer DEFAULT 50 NOT NULL,
	`linked_internal_alumnus_id` integer,
	`review_status` text DEFAULT 'Pending review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `external_discovery_searches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_internal_alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_result_search_provider` ON `external_discovery_results` (`search_id`,`provider_result_id`);--> statement-breakpoint
CREATE INDEX `idx_external_result_search` ON `external_discovery_results` (`search_id`);--> statement-breakpoint
CREATE INDEX `idx_external_result_match_status` ON `external_discovery_results` (`match_status`);--> statement-breakpoint
CREATE TABLE `external_discovery_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'pdl' NOT NULL,
	`filters_json` text NOT NULL,
	`criteria_summary` text NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`existing_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`mode` text NOT NULL,
	`initiated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `field_change_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`field` text NOT NULL,
	`old_value` text DEFAULT '' NOT NULL,
	`new_value` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`provider_action` text DEFAULT '' NOT NULL,
	`credits_charged` integer DEFAULT 0 NOT NULL,
	`initiated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_field_change_alumnus` ON `field_change_history` (`alumnus_id`);--> statement-breakpoint
ALTER TABLE `alumni` ADD `graduation_year` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `education` text DEFAULT 'Indian Institute of Management Lucknow' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `raw_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `pdl_person_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `lusha_person_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `discovery_source` text DEFAULT 'Manual import' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `discovery_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `last_pdl_refresh` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `last_lusha_enrichment` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `email_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `phone_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `email_retrieved_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `phone_retrieved_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_alumni_company` ON `alumni` (`company`);--> statement-breakpoint
CREATE INDEX `idx_alumni_pdl_person_id` ON `alumni` (`pdl_person_id`);--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `search_id` integer;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `result_count` integer DEFAULT 0 NOT NULL;