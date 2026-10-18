CREATE TABLE `provider_collection_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`actor_user_id` integer NOT NULL,
	`alumnus_id` integer,
	`target_reference` text NOT NULL,
	`target_fingerprint` text NOT NULL,
	`request_key` text NOT NULL,
	`dataset_id` text DEFAULT '' NOT NULL,
	`provider_job_id` text DEFAULT '' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'CLAIMED' NOT NULL,
	`last_status_check_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`error_category` text DEFAULT '' NOT NULL,
	`result_provider_history_id` integer,
	`evidence_json` text DEFAULT '' NOT NULL,
	`usage_state` text DEFAULT 'not_applicable' NOT NULL,
	`provider_reported_usage` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_provider_history_id`) REFERENCES `provider_response_history`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_collection_attempt_count_check" CHECK("provider_collection_attempts"."attempt_count" = 1),
	CONSTRAINT "provider_collection_generation_check" CHECK("provider_collection_attempts"."generation" > 0),
	CONSTRAINT "provider_collection_status_check" CHECK("provider_collection_attempts"."status" in ('CLAIMED', 'TRIGGER_IN_PROGRESS', 'SNAPSHOT_PENDING', 'SNAPSHOT_RUNNING', 'SNAPSHOT_READY', 'RESULT_RETRIEVED', 'EVIDENCE_STORED', 'REVIEW_REQUIRED', 'FAILED_BEFORE_TRIGGER', 'TRIGGER_OUTCOME_UNKNOWN', 'FAILED_AFTER_TRIGGER', 'BLOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_collection_request_key` ON `provider_collection_attempts` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_collection_job` ON `provider_collection_attempts` (`provider`,`provider_job_id`) WHERE "provider_collection_attempts"."provider_job_id" != '';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_collection_active_target` ON `provider_collection_attempts` (`provider`,`target_fingerprint`) WHERE "provider_collection_attempts"."status" in ('CLAIMED', 'TRIGGER_IN_PROGRESS', 'SNAPSHOT_PENDING', 'SNAPSHOT_RUNNING', 'SNAPSHOT_READY', 'RESULT_RETRIEVED');--> statement-breakpoint
CREATE INDEX `idx_provider_collection_target` ON `provider_collection_attempts` (`provider`,`target_fingerprint`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_provider_collection_status` ON `provider_collection_attempts` (`provider`,`status`,`updated_at`);
