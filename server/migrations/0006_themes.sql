-- Themes.
--
-- A colour theme the learner made, or a built-in they edited, is their own
-- work, and their own work is backed up (#66). Backed up, in this app, means
-- it goes through the sync: the same last-write-wins row with a tombstone
-- that carries the learner's own words, so an edit made on the phone reaches
-- the laptop and a deletion is not brought back by the device that missed it.
-- The row is `words` with `id` for `k`, and the record is stored whole: what
-- a theme contains is the app's business.

CREATE TABLE IF NOT EXISTS themes (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_themes_seq ON themes(user_id, seq);
