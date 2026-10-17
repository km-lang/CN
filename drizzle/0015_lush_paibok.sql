CREATE TABLE `alumni_employment_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer,
	`discovery_result_id` integer,
	`evidence_source` text NOT NULL,
	`provider_employee_id` text DEFAULT '' NOT NULL,
	`provider_response_id` integer,
	`stable_company_id` text DEFAULT '' NOT NULL,
	`original_company_name` text NOT NULL,
	`original_job_title` text NOT NULL,
	`normalized_job_title` text DEFAULT '' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`observed_at` text NOT NULL,
	`evidence_version` text DEFAULT '1' NOT NULL,
	`verification_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`reviewer_status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employment_evidence_source_position` ON `alumni_employment_evidence` (`evidence_source`,`provider_response_id`,`provider_employee_id`,`stable_company_id`,`original_job_title`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_employment_evidence_alumnus_current` ON `alumni_employment_evidence` (`alumnus_id`,`is_current`,`is_deleted`);--> statement-breakpoint
CREATE INDEX `idx_employment_evidence_employee` ON `alumni_employment_evidence` (`provider_employee_id`);--> statement-breakpoint
CREATE TABLE `alumni_profile_change_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`field` text NOT NULL,
	`old_value` text DEFAULT '' NOT NULL,
	`proposed_value` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`expected_record_version` integer NOT NULL,
	`proposed_by` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "profile_change_proposal_status_check" CHECK("alumni_profile_change_proposals"."status" in ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `idx_profile_change_proposal_alumnus_status` ON `alumni_profile_change_proposals` (`alumnus_id`,`status`);--> statement-breakpoint
CREATE TABLE `provider_company_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mapping_id` integer NOT NULL,
	`normalized_alias` text NOT NULL,
	`display_alias` text NOT NULL,
	`status` text DEFAULT 'VERIFIED' NOT NULL,
	`verified_by` text NOT NULL,
	`verified_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`mapping_id`) REFERENCES `provider_company_mappings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_company_alias_status_check" CHECK("provider_company_aliases"."status" in ('VERIFIED', 'CONFLICT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_company_alias_unique` ON `provider_company_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `idx_provider_company_alias_mapping` ON `provider_company_aliases` (`mapping_id`);--> statement-breakpoint
ALTER TABLE `alumni` ADD `record_version` integer DEFAULT 1 NOT NULL;