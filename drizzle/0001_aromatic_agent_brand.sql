CREATE TABLE `audioSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`transcript` text,
	`summary` text,
	`summaryType` varchar(32) DEFAULT 'medium',
	`summaryLanguage` varchar(32) DEFAULT 'en',
	`translation` text,
	`translationLanguage` varchar(32),
	`deepgramCalls` int DEFAULT 0,
	`accumulatedSize` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audioSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `audioSessions_sessionId_unique` UNIQUE(`sessionId`)
);
