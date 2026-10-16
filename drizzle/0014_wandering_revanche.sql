CREATE TABLE `corporate_opportunities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_key` text NOT NULL,
	`company` text NOT NULL,
	`alumnus_id` integer,
	`engagement_id` integer,
	`owner_user_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'IDENTIFIED' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`follow_up_date` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` integer NOT NULL,
	`last_updated_by_user_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagement_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_updated_by_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "corporate_opportunity_company_check" CHECK(length(trim("corporate_opportunities"."company")) > 0),
	CONSTRAINT "corporate_opportunity_title_check" CHECK(length(trim("corporate_opportunities"."title")) > 0),
	CONSTRAINT "corporate_opportunity_version_check" CHECK("corporate_opportunities"."version" > 0),
	CONSTRAINT "corporate_opportunity_stage_check" CHECK("corporate_opportunities"."stage" in ('IDENTIFIED', 'QUALIFYING', 'OUTREACH_IN_PROGRESS', 'IN_DISCUSSION', 'CONFIRMED', 'ON_HOLD', 'CLOSED_LOST')),
	CONSTRAINT "corporate_opportunity_outcome_check" CHECK("corporate_opportunities"."stage" not in ('CONFIRMED', 'CLOSED_LOST') or length(trim("corporate_opportunities"."outcome")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_corporate_opportunities_key` ON `corporate_opportunities` (`opportunity_key`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunities_company` ON `corporate_opportunities` (`company`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunities_alumnus` ON `corporate_opportunities` (`alumnus_id`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunities_engagement` ON `corporate_opportunities` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunities_owner_stage` ON `corporate_opportunities` (`owner_user_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunities_follow_up` ON `corporate_opportunities` (`follow_up_date`);--> statement-breakpoint
CREATE TABLE `corporate_opportunity_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`opportunity_id` integer NOT NULL,
	`actor_user_id` integer NOT NULL,
	`action` text NOT NULL,
	`from_stage` text DEFAULT '' NOT NULL,
	`to_stage` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`changes_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `corporate_opportunities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunity_history_opportunity` ON `corporate_opportunity_history` (`opportunity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_corporate_opportunity_history_actor` ON `corporate_opportunity_history` (`actor_user_id`);