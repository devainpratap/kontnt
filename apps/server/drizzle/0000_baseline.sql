CREATE TABLE `job_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`step_name` text NOT NULL,
	`status` text NOT NULL,
	`prompt_path` text,
	`output_path` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`job_path` text NOT NULL
);
