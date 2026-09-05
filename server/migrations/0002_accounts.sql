-- Accounts.
--
-- The first schema had no notion of a user: every row was global, and `words.k`
-- was a bare primary key, so two accounts would have collided on the same word.
-- Identity itself is Cloudflare Access's job (email one-time code, or Google or
-- GitHub); this schema only records who a verified email belongs to and keys
-- every row by it.
--
-- The tables are recreated rather than altered because SQLite cannot change a
-- primary key in place, and because at this point they hold no data.

DROP TABLE IF EXISTS words;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS counter;

CREATE TABLE users (
  id      TEXT PRIMARY KEY,          -- opaque, derived from the verified email
  email   TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_seen INTEGER
);

-- A token per device, hashed. Losing the database does not hand anyone a
-- working key, and a lost phone is one row to revoke.
CREATE TABLE devices (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'full',   -- 'full' | 'words'
  created    INTEGER NOT NULL,
  last_seen  INTEGER,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_devices_user ON devices(user_id, revoked);

CREATE TABLE words (
  user_id   TEXT NOT NULL,
  k         TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);
CREATE INDEX idx_words_seq ON words(user_id, seq);

CREATE TABLE cards (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_cards_seq ON cards(user_id, seq);

CREATE TABLE reviews (
  user_id TEXT NOT NULL,
  uid     TEXT NOT NULL,
  data    TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  seq     INTEGER NOT NULL,
  PRIMARY KEY (user_id, uid)
);
CREATE INDEX idx_reviews_seq ON reviews(user_id, seq);

CREATE TABLE lessons (
  user_id   TEXT NOT NULL,
  id        TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_lessons_seq ON lessons(user_id, seq);

-- One sequence per account, so another account's writes never advance your
-- pull cursor and cause pointless downloads.
CREATE TABLE counter (
  user_id TEXT PRIMARY KEY,
  value   INTEGER NOT NULL
);
