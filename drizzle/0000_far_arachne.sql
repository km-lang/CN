CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alumni` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_key` text NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`batch` integer NOT NULL,
	`programme` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`function` text NOT NULL,
	`seniority` text NOT NULL,
	`location` text NOT NULL,
	`previous_companies` text DEFAULT '' NOT NULL,
	`experience_years` integer DEFAULT 0 NOT NULL,
	`confidence` integer DEFAULT 50 NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`linkedin_url` text DEFAULT '' NOT NULL,
	`verified_label` text DEFAULT 'Not yet verified' NOT NULL,
	`outreach_status` text DEFAULT 'Not contacted' NOT NULL,
	`note` text DEFAULT 'No placement context recorded.' NOT NULL,
	`hiring_influence` text DEFAULT 'Unknown / Not assessed' NOT NULL,
	`iiml_relationship` text DEFAULT 'Unknown / Not assessed' NOT NULL,
	`warm_intro_potential` text DEFAULT 'Unknown / Not assessed' NOT NULL,
	`profile_match` text DEFAULT 'Unverified' NOT NULL,
	`current_company_verification` text DEFAULT 'Unverified' NOT NULL,
	`designation_verification` text DEFAULT 'Unverified' NOT NULL,
	`email_verification` text DEFAULT 'Unverified' NOT NULL,
	`phone_verification` text DEFAULT 'Unverified' NOT NULL,
	`location_verification` text DEFAULT 'Unverified' NOT NULL,
	`source` text DEFAULT 'Manual import' NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_profile_key` ON `alumni` (`profile_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alumni_email` ON `alumni` (`email`) WHERE "alumni"."email" != '';--> statement-breakpoint
CREATE TABLE `company_priorities` (
	`company` text PRIMARY KEY NOT NULL,
	`priority` text NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`row_count` integer NOT NULL,
	`imported_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
