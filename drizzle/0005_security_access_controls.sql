CREATE TABLE `alumni_data_lifecycle` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`deletion_requested_at` text DEFAULT '' NOT NULL,
	`archived_at` text DEFAULT '' NOT NULL,
	`anonymized_at` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_lifecycle_alumnus` ON `alumni_data_lifecycle` (`alumnus_id`);--> statement-breakpoint
CREATE INDEX `idx_alumni_lifecycle_status` ON `alumni_data_lifecycle` (`status`);--> statement-breakpoint
CREATE TABLE `alumni_privacy_controls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alumnus_id` integer NOT NULL,
	`general_contact_status` text DEFAULT 'Unknown' NOT NULL,
	`professional_engagement_status` text DEFAULT 'Unknown' NOT NULL,
	`birthday_engagement_status` text DEFAULT 'Unknown' NOT NULL,
	`consent_source` text DEFAULT 'Unknown' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_privacy_alumnus` ON `alumni_privacy_controls` (`alumnus_id`);--> statement-breakpoint
CREATE INDEX `idx_alumni_privacy_general_status` ON `alumni_privacy_controls` (`general_contact_status`);--> statement-breakpoint
CREATE TABLE `application_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_identity` text DEFAULT '' NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_users_email` ON `application_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_users_external_identity` ON `application_users` (`external_identity`) WHERE "application_users"."external_identity" != '';--> statement-breakpoint
CREATE INDEX `idx_application_users_role_enabled` ON `application_users` (`role`,`enabled`);--> statement-breakpoint
CREATE TABLE `security_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`actor_identity` text DEFAULT 'System' NOT NULL,
	`actor_name` text DEFAULT 'System' NOT NULL,
	`actor_role` text DEFAULT 'SYSTEM' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`result` text DEFAULT 'success' NOT NULL,
	`source` text DEFAULT 'application' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_actor` ON `security_audit_events` (`actor_user_id`);--> statement-breakpoint
CREATE INDEX `idx_security_audit_entity` ON `security_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_security_audit_created_at` ON `security_audit_events` (`created_at`);