DROP TABLE `split_day_exercises`;

DROP TABLE `split_days`;

DROP TABLE `splits`;

ALTER TABLE `sessions` DROP COLUMN `split_id`;

ALTER TABLE `sessions` DROP COLUMN `split_day_id`;
