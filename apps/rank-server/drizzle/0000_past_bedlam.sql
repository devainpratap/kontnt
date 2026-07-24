CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`keyword_id` text,
	`kind` text NOT NULL,
	`detected_at` text NOT NULL,
	`delta` real,
	`payload` text DEFAULT '{}' NOT NULL,
	`acknowledged_at` text
);
--> statement-breakpoint
CREATE INDEX `alerts_client_ack_idx` ON `alerts` (`client_id`,`acknowledged_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`primary_domain` text NOT NULL,
	`gsc_property` text,
	`gsc_property_type` text,
	`brand_terms` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`client_path` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_slug_unique` ON `clients` (`slug`);--> statement-breakpoint
CREATE TABLE `google_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`scope` text NOT NULL,
	`connected_at` text NOT NULL,
	`last_error_at` text,
	`last_error_message` text
);
--> statement-breakpoint
CREATE TABLE `gsc_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`date` text NOT NULL,
	`query` text NOT NULL,
	`page` text NOT NULL,
	`device` text DEFAULT 'ALL' NOT NULL,
	`country` text DEFAULT 'ALL' NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gsc_daily_client_date_idx` ON `gsc_daily` (`client_id`,`date`);--> statement-breakpoint
CREATE INDEX `gsc_daily_client_query_idx` ON `gsc_daily` (`client_id`,`query`);--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_daily_row_unique` ON `gsc_daily` (`client_id`,`date`,`query`,`page`,`device`,`country`);--> statement-breakpoint
CREATE TABLE `gsc_daily_totals` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`date` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`ctr` real DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_daily_totals_client_date_unique` ON `gsc_daily_totals` (`client_id`,`date`);--> statement-breakpoint
CREATE TABLE `gsc_weekly_rollup` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`week_start` text NOT NULL,
	`query` text NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`avg_position` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gsc_weekly_client_week_idx` ON `gsc_weekly_rollup` (`client_id`,`week_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_weekly_row_unique` ON `gsc_weekly_rollup` (`client_id`,`week_start`,`query`);--> statement-breakpoint
CREATE TABLE `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`prompt_path` text,
	`output_path` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `insights_client_period_idx` ON `insights` (`client_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`phrase` text NOT NULL,
	`country` text DEFAULT 'in' NOT NULL,
	`device` text DEFAULT 'desktop' NOT NULL,
	`location` text,
	`target_url` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `keywords_client_id_idx` ON `keywords` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `keywords_identity_unique` ON `keywords` (`client_id`,`phrase`,`country`,`device`,`location`);--> statement-breakpoint
CREATE TABLE `rank_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL,
	`checked_at` text NOT NULL,
	`checked_date` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`position` real,
	`ranking_url` text,
	`previous_position` real,
	`raw_path` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `rank_checks_keyword_checked_idx` ON `rank_checks` (`keyword_id`,`checked_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `rank_checks_keyword_day_source_unique` ON `rank_checks` (`keyword_id`,`checked_date`,`source`);--> statement-breakpoint
CREATE TABLE `serp_features` (
	`id` text PRIMARY KEY NOT NULL,
	`rank_check_id` text NOT NULL,
	`feature` text NOT NULL,
	`present` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `serp_features_rank_check_idx` ON `serp_features` (`rank_check_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `serp_features_check_feature_unique` ON `serp_features` (`rank_check_id`,`feature`);--> statement-breakpoint
CREATE TABLE `serp_results` (
	`id` text PRIMARY KEY NOT NULL,
	`rank_check_id` text NOT NULL,
	`position` integer NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`is_client` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `serp_results_rank_check_idx` ON `serp_results` (`rank_check_id`);--> statement-breakpoint
CREATE INDEX `serp_results_domain_idx` ON `serp_results` (`domain`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`rows_written` integer DEFAULT 0 NOT NULL,
	`items_ok` integer DEFAULT 0 NOT NULL,
	`items_blocked` integer DEFAULT 0 NOT NULL,
	`items_failed` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_client_kind_idx` ON `sync_runs` (`client_id`,`kind`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`);