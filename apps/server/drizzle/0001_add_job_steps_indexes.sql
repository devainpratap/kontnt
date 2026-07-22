CREATE INDEX `job_steps_job_id_idx` ON `job_steps` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_steps_job_id_step_name_unique` ON `job_steps` (`job_id`,`step_name`);