CREATE TABLE `operator_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ran_at` text NOT NULL,
	`health_level` text NOT NULL,
	`findings_count` integer DEFAULT 0 NOT NULL,
	`actions_count` integer DEFAULT 0 NOT NULL,
	`escalations_count` integer DEFAULT 0 NOT NULL,
	`escalations` text DEFAULT '[]' NOT NULL,
	`acknowledged_at` text,
	`summary` text DEFAULT '' NOT NULL,
	`journal_path` text
);
--> statement-breakpoint
CREATE INDEX `operator_runs_ran_at_idx` ON `operator_runs` (`ran_at`);