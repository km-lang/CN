CREATE TABLE `application_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_subject_id` text NOT NULL,
	`verified_email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`provider_domain` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_authenticated_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`application_user_id`) REFERENCES `application_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_identities_provider_subject` ON `application_identities` (`provider`,`provider_subject_id`);--> statement-breakpoint
CREATE INDEX `idx_application_identities_user` ON `application_identities` (`application_user_id`);--> statement-breakpoint
CREATE INDEX `idx_application_identities_verified_email` ON `application_identities` (`verified_email`);
