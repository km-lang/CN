CREATE TABLE `provider_response_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`alumnus_id` integer,
	`alumnus_name` text NOT NULL,
	`operation` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`request_summary` text DEFAULT '' NOT NULL,
	`response_summary` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`requested_by` text DEFAULT 'Public workspace user' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`alumnus_id`) REFERENCES `alumni`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`monthly_credit_limit` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
