-- Arena: keep the runner-up of a finished tournament next to the champion.
-- `runner_up_id` is an `arena_fighters.id` of the same tournament, set when the final settles. It is
-- NULL while the tournament is open, and for tournaments that finished before this migration (their
-- second place was never stored).
ALTER TABLE arena_tournaments ADD COLUMN runner_up_id INTEGER REFERENCES arena_fighters (id);
