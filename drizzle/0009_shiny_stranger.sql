ALTER TABLE `alumni` ADD `professional_data_status` text DEFAULT 'Needs assessment' NOT NULL;--> statement-breakpoint
ALTER TABLE `alumni` ADD `professional_data_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `sender` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `recipient` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `purpose` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `template_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `approved_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_actions` ADD `approved_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `provider_event_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `previous_company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `previous_role` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `new_company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `new_role` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `source_confidence` text DEFAULT 'Unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `engagement_events` ADD `source_status` text DEFAULT 'Unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE `external_discovery_searches` ADD `requested_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `message_templates` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `provider_reported_credits` integer;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `usage_state` text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `reconciled_credits` integer;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `reconciliation_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `reconciled_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_response_history` ADD `reconciled_at` text DEFAULT '' NOT NULL;