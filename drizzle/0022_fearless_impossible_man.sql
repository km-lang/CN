CREATE TABLE `alumni_source_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`mutation_request_key` text NOT NULL,
	`source_row_key` text NOT NULL,
	`filename` text NOT NULL,
	`source_system` text NOT NULL,
	`source_date` text DEFAULT '' NOT NULL,
	`observed_json` text DEFAULT '{}' NOT NULL,
	`imported_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_source_observation_request_row` ON `alumni_source_observations` (`mutation_request_key`,`source_row_key`);--> statement-breakpoint
CREATE INDEX `idx_alumni_source_observation_alumnus_date` ON `alumni_source_observations` (`alumnus_id`,`created_at`);