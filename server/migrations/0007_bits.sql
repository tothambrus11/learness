-- Grammar bits.
--
-- A grammar bit the learner has committed to — a tense, a rule — is one act
-- of theirs, and it travels: opened on the phone is open on the laptop, and a
-- closing is a tombstone that is not undone by the device that missed it.
-- The same row as themes, keyed by the rule's id (GRAMMAR.md), the record
-- stored whole; what a bit contains is the app's business.

CREATE TABLE IF NOT EXISTS bits (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_bits_seq ON bits(user_id, seq);
