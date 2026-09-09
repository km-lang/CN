CREATE TABLE `birthday_data` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`birth_month_day` text NOT NULL,
	`full_birth_date` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`last_verified_at` text DEFAULT '' NOT NULL,
	`last_updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_birthday_data_alumnus` ON `birthday_data` (`alumnus_id`);--> statement-breakpoint
CREATE INDEX `idx_birthday_data_month_day` ON `birthday_data` (`birth_month_day`);--> statement-breakpoint
CREATE TABLE `communication_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`engagement_type` text DEFAULT 'All' NOT NULL,
	`status` text DEFAULT 'Unknown' NOT NULL,
	`source` text DEFAULT 'Not recorded' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_communication_preference_alumnus_type` ON `communication_preferences` (`alumnus_id`,`engagement_type`);--> statement-breakpoint
CREATE TABLE `engagement_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action_key` text NOT NULL,
	`event_id` integer NOT NULL,
	`alumnus_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`channel` text NOT NULL,
	`performed_by` text NOT NULL,
	`performed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`template_id` integer,
	`subject` text DEFAULT '' NOT NULL,
	`message_summary` text DEFAULT '' NOT NULL,
	`external_message_id` text DEFAULT '' NOT NULL,
	`delivery_status` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `engagement_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_action_key` ON `engagement_actions` (`action_key`);--> statement-breakpoint
CREATE INDEX `idx_engagement_action_event` ON `engagement_actions` (`event_id`);--> statement-breakpoint
CREATE TABLE `engagement_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `engagement_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engagement_audit_event` ON `engagement_audit_log` (`event_id`);--> statement-breakpoint
CREATE TABLE `engagement_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`alumnus_id` integer NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`event_type` text NOT NULL,
	`event_subtype` text DEFAULT '' NOT NULL,
	`event_title` text NOT NULL,
	`event_description` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`source_reference_id` text DEFAULT '' NOT NULL,
	`source_detected_date` text DEFAULT '' NOT NULL,
	`event_date` text NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`first_viewed_at` text DEFAULT '' NOT NULL,
	`last_viewed_by` text DEFAULT '' NOT NULL,
	`acknowledged_at` text DEFAULT '' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`assigned_at` text DEFAULT '' NOT NULL,
	`action_planned_at` text DEFAULT '' NOT NULL,
	`action_taken_at` text DEFAULT '' NOT NULL,
	`action_taken_by` text DEFAULT '' NOT NULL,
	`action_type` text DEFAULT '' NOT NULL,
	`action_channel` text DEFAULT '' NOT NULL,
	`message_template_id` integer,
	`message_subject` text DEFAULT '' NOT NULL,
	`message_summary` text DEFAULT '' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`delivery_status` text DEFAULT '' NOT NULL,
	`response_received` integer DEFAULT false NOT NULL,
	`response_received_at` text DEFAULT '' NOT NULL,
	`response_type` text DEFAULT '' NOT NULL,
	`follow_up_required` integer DEFAULT false NOT NULL,
	`follow_up_date` text DEFAULT '' NOT NULL,
	`response_notes` text DEFAULT '' NOT NULL,
	`closed_at` text DEFAULT '' NOT NULL,
	`skipped_at` text DEFAULT '' NOT NULL,
	`skip_reason` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT 'System' NOT NULL,
	`last_updated_by` text DEFAULT 'System' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_engagement_event_key` ON `engagement_events` (`event_key`);--> statement-breakpoint
CREATE INDEX `idx_engagement_event_status_date` ON `engagement_events` (`status`,`event_date`);--> statement-breakpoint
CREATE INDEX `idx_engagement_event_alumnus` ON `engagement_events` (`alumnus_id`);--> statement-breakpoint
CREATE TABLE `engagement_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`response_type` text NOT NULL,
	`received_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`follow_up_required` integer DEFAULT false NOT NULL,
	`follow_up_date` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `engagement_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engagement_response_event` ON `engagement_responses` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`viewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `engagement_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_event_view_event_user` ON `event_views` (`event_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_key` text NOT NULL,
	`name` text NOT NULL,
	`event_type` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'Approved' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_message_template_key` ON `message_templates` (`template_key`);