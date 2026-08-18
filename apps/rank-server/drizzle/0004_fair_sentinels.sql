CREATE TABLE `scheduler_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_name` text NOT NULL,
	`ran_at` text NOT NULL,
	`trigger` text DEFAULT 'cron' NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`summary` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_task_ran_at_idx` ON `scheduler_runs` (`task_name`,`ran_at`);