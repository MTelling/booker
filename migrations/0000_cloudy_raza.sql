CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`allow_proposals` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`admin_token` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `slots_event_idx` ON `slots` (`event_id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`event_id` text NOT NULL,
	`voter_name` text NOT NULL,
	`choice` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_slot_voter_idx` ON `votes` (`slot_id`,`voter_name`);--> statement-breakpoint
CREATE INDEX `votes_event_idx` ON `votes` (`event_id`);