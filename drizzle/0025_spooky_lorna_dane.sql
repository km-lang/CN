ALTER TABLE `coresignal_webhook_events` ADD `provider` text DEFAULT 'coresignal' NOT NULL;--> statement-breakpoint
ALTER TABLE `coresignal_webhook_events` ADD `dataset` text DEFAULT 'employee_base_experience' NOT NULL;--> statement-breakpoint
ALTER TABLE `coresignal_webhook_events` ADD `source_provenance` text DEFAULT 'Base Employee Experience webhook' NOT NULL;--> statement-breakpoint
ALTER TABLE `coresignal_webhook_events` ADD `error_state` text DEFAULT '' NOT NULL;