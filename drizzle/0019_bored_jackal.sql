CREATE TABLE `provisional_alumni_intakes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`discovery_result_id` integer NOT NULL,
	`search_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_person_id` text NOT NULL,
	`source_profile_url` text NOT NULL,
	`normalized_profile_key` text NOT NULL,
	`provider_observations_json` text NOT NULL,
	`query_constraints_json` text NOT NULL,
	`verification_state_json` text NOT NULL,
	`intake_actor_user_id` integer NOT NULL,
	`intake_actor_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_result_id`) REFERENCES `external_discovery_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_id`) REFERENCES `external_discovery_searches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_actor_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provisional_intake_provider_check" CHECK("provisional_alumni_intakes"."provider" = 'coresignal')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provisional_intake_alumnus` ON `provisional_alumni_intakes` (`alumnus_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provisional_intake_result` ON `provisional_alumni_intakes` (`discovery_result_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provisional_intake_provider_person` ON `provisional_alumni_intakes` (`provider`,`provider_person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provisional_intake_profile` ON `provisional_alumni_intakes` (`normalized_profile_key`);--> statement-breakpoint
CREATE INDEX `idx_provisional_intake_search` ON `provisional_alumni_intakes` (`search_id`);--> statement-breakpoint
ALTER TABLE `alumni` ADD `intake_status` text DEFAULT 'REVIEW_REQUIRED' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_alumni_intake_status` ON `alumni` (`intake_status`);