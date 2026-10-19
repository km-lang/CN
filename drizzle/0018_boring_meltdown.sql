CREATE TABLE `external_discovery_candidate_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`result_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_person_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`source_provenance` text NOT NULL,
	`profile_url` text DEFAULT '' NOT NULL,
	`observed_institution` text DEFAULT '' NOT NULL,
	`education_start_year` integer,
	`education_end_year` integer,
	`graduation_year` integer,
	`programme` text DEFAULT '' NOT NULL,
	`current_company` text DEFAULT '' NOT NULL,
	`current_designation` text DEFAULT '' NOT NULL,
	`seniority` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`decisions_json` text NOT NULL,
	`reviewer_decision` text NOT NULL,
	`verification_reason` text NOT NULL,
	`reviewer_user_id` integer NOT NULL,
	`reviewer_name` text NOT NULL,
	`request_key` text NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `external_discovery_searches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_id`) REFERENCES `external_discovery_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "external_candidate_evidence_decision_check" CHECK("external_discovery_candidate_evidence"."reviewer_decision" in ('SUPPORTS', 'REJECTS', 'INSUFFICIENT'))
);
--> statement-breakpoint
CREATE INDEX `idx_external_candidate_evidence_result` ON `external_discovery_candidate_evidence` (`result_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_candidate_evidence_request` ON `external_discovery_candidate_evidence` (`result_id`,`request_key`);