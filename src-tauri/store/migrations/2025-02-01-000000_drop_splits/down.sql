-- Splits were removed for good: the data is gone, only the shape returns.
ALTER TABLE sessions ADD split_id text;
ALTER TABLE sessions ADD split_day_id text;
CREATE TABLE splits (id text PRIMARY KEY NOT NULL, name text NOT NULL, description text, built_in integer DEFAULT false NOT NULL);
CREATE TABLE split_days (id text PRIMARY KEY NOT NULL, split_id text NOT NULL, name text NOT NULL, position integer NOT NULL, FOREIGN KEY (split_id) REFERENCES splits(id) ON DELETE cascade);
CREATE TABLE split_day_exercises (day_id text NOT NULL, exercise_id text NOT NULL, position integer NOT NULL, PRIMARY KEY(day_id, exercise_id), FOREIGN KEY (day_id) REFERENCES split_days(id) ON DELETE cascade);
