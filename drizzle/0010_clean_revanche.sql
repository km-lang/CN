CREATE TABLE `programme_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_by` text DEFAULT 'System' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_programme_options_code` ON `programme_options` (`code`);
--> statement-breakpoint
INSERT INTO `programme_options` (`code`, `name`, `active`, `sort_order`, `updated_by`) VALUES
  ('PGP', 'PGP', 1, 10, 'Migration 0010'),
  ('ABM', 'ABM', 1, 20, 'Migration 0010'),
  ('SM', 'SM', 1, 30, 'Migration 0010');
