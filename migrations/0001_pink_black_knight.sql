CREATE TABLE `presence` (
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `name`)
);
