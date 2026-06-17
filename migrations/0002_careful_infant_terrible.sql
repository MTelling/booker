CREATE TABLE `create_counts` (
	`ip` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`ip`, `day`)
);
