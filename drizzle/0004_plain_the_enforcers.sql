CREATE TABLE `alumni_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`intermediary_alumnus_id` integer NOT NULL,
	`target_alumnus_id` integer NOT NULL,
	`relationship_type` text NOT NULL,
	`evidence` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`successful_introductions` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'Manual confirmation' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`intermediary_alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_relationship_pair` ON `alumni_relationships` (`intermediary_alumnus_id`,`target_alumnus_id`);--> statement-breakpoint
CREATE INDEX `idx_alumni_relationship_target` ON `alumni_relationships` (`target_alumnus_id`);--> statement-breakpoint
CREATE TABLE `provider_refresh_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_response_id` integer NOT NULL,
	`alumnus_id` integer NOT NULL,
	`proposed_changes_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Pending review' NOT NULL,
	`requested_by` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`provider_response_id`) REFERENCES `provider_response_history`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_provider_refresh_review_alumnus` ON `provider_refresh_reviews` (`alumnus_id`,`status`);--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `review_note` text DEFAULT '' NOT NULL;