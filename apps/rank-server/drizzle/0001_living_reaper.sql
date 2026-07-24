CREATE TABLE `provider_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`year_month` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_usage_provider_month_unique` ON `provider_usage` (`provider`,`year_month`);