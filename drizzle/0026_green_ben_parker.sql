CREATE TABLE `brightdata_snapshot_evidence` (
	`attempt_id` integer PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'brightdata' NOT NULL,
	`snapshot_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`requested_url` text NOT NULL,
	`returned_url` text DEFAULT '' NOT NULL,
	`canonical_returned_url` text DEFAULT '' NOT NULL,
	`identity_url_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`requested_at` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`provider_timestamp_json` text DEFAULT '' NOT NULL,
	`normalizer_version` integer NOT NULL,
	`raw_json` text NOT NULL,
	`raw_sha256` text NOT NULL,
	`normalized_json` text NOT NULL,
	`retention_until` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `provider_collection_attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "brightdata_snapshot_identity_status_check" CHECK("brightdata_snapshot_evidence"."identity_url_status" in ('MATCH', 'MISMATCH', 'UNVERIFIED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_brightdata_snapshot_evidence_snapshot` ON `brightdata_snapshot_evidence` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `idx_brightdata_snapshot_evidence_retention` ON `brightdata_snapshot_evidence` (`retention_until`);