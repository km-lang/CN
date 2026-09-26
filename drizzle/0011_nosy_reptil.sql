ALTER TABLE `alumni` ADD `coresignal_employee_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `last_professional_data_refresh` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `professional_data_provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `provider_freshness_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_affiliation_status` text DEFAULT 'Not assessed' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_education_programme` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_education_start_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_education_end_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_institution_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `iiml_institution_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `current_company_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `current_company_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `current_role_start_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `current_industry` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `current_role_ambiguous` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_alumni_coresignal_employee_id` ON `alumni` (`coresignal_employee_id`);--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `affiliation_status` text DEFAULT 'Potential alumnus — review required' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `education_programme` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `education_start_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `education_end_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `institution_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `institution_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `current_company_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `current_company_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `current_role_start_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `current_industry` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `current_role_ambiguous` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_results` ADD `provider_freshness_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `application_units` integer DEFAULT 0 NOT NULL;