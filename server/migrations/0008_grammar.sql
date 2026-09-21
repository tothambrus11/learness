-- The grammar's state and log (GRAMMAR.md, "The records").
--
-- A rule card is the FSRS state of one grammar rule in one mode, the same
-- row as cards: last-write-wins on updatedAt, no tombstone. An attempt is
-- one grammar exercise answered, the same row as reviews: a fact, kept if
-- new and ignored if seen, indexed by its moment. Both stored whole; what
-- they contain is the app's business.

CREATE TABLE IF NOT EXISTS rulecards (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_rulecards_seq ON rulecards(user_id, seq);

CREATE TABLE IF NOT EXISTS attempts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uid     TEXT NOT NULL,
  data    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  seq     INTEGER NOT NULL,
  PRIMARY KEY (user_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_attempts_seq ON attempts(user_id, seq);
