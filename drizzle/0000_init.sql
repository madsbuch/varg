CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`metric` text NOT NULL,
	`muscles` text DEFAULT '[]' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`reps` integer,
	`date` text NOT NULL,
	`session_id` text,
	`note` text,
	`manual` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`finished_at` text,
	`split_id` text,
	`split_day_id` text,
	`template_id` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `split_day_exercises` (
	`day_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`day_id`, `exercise_id`),
	FOREIGN KEY (`day_id`) REFERENCES `split_days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `split_days` (
	`id` text PRIMARY KEY NOT NULL,
	`split_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`split_id`) REFERENCES `splits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `splits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`built_in` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`weight` real,
	`reps` integer,
	`seconds` real,
	`meters` real,
	`rpe` real,
	`done` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `session_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
