CREATE TABLE `provider_company_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`normalized_company_key` text NOT NULL,
	`display_name` text NOT NULL,
	`provider` text NOT NULL,
	`provider_company_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`mapping_source` text DEFAULT '' NOT NULL,
	`evidence_reference` text DEFAULT '' NOT NULL,
	`provider_source_id` text DEFAULT '' NOT NULL,
	`provider_company_url` text DEFAULT '' NOT NULL,
	`verified_by` text DEFAULT '' NOT NULL,
	`verified_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "provider_company_mapping_status_check" CHECK("provider_company_mappings"."status" in ('VERIFIED', 'UNVERIFIED', 'CONFLICT')),
	CONSTRAINT "provider_company_mapping_identity_check" CHECK(length(trim("provider_company_mappings"."normalized_company_key")) > 0 and length(trim("provider_company_mappings"."display_name")) > 0 and length(trim("provider_company_mappings"."provider")) > 0),
	CONSTRAINT "provider_company_mapping_verified_check" CHECK("provider_company_mappings"."status" != 'VERIFIED' or (length(trim("provider_company_mappings"."provider_company_id")) > 0 and length(trim("provider_company_mappings"."verified_by")) > 0 and length(trim("provider_company_mappings"."verified_at")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_company_mapping_company_provider` ON `provider_company_mappings` (`normalized_company_key`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_company_mapping_provider_id` ON `provider_company_mappings` (`provider`,`provider_company_id`) WHERE "provider_company_mappings"."provider_company_id" != '';--> statement-breakpoint
CREATE INDEX `idx_provider_company_mapping_status` ON `provider_company_mappings` (`provider`,`status`);