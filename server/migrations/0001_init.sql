-- One user, several devices. Rows carry a monotonic `seq` so a device can pull
-- "everything since cursor N" without relying on clocks agreeing.

CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'full',   -- 'full' | 'words'
  created    INTEGER NOT NULL,
  last_seen  INTEGER
);

CREATE TABLE IF NOT EXISTS words (
  k         TEXT PRIMARY KEY,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  seq       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_seq ON words(seq);

CREATE TABLE IF NOT EXISTS cards (
  id        TEXT PRIMARY KEY,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  seq       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_seq ON cards(seq);

-- Append-only. Rows are never updated, which is what makes merging a union.
CREATE TABLE IF NOT EXISTS reviews (
  uid  TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  seq  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_seq ON reviews(seq);

CREATE TABLE IF NOT EXISTS lessons (
  id        TEXT PRIMARY KEY,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  seq       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_seq ON lessons(seq);

CREATE TABLE IF NOT EXISTS counter (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO counter (name, value) VALUES ('seq', 0);
