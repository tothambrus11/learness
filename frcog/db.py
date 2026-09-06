"""SQLite schema and helpers. The database is the source of truth; Anki decks,
audio files and the web app are all views over it."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS words (
    id           INTEGER PRIMARY KEY,
    lemma        TEXT NOT NULL,
    pos          TEXT NOT NULL,
    display_form TEXT NOT NULL,   -- what the card teaches: "le bug"
    type_answer  TEXT NOT NULL,   -- what the learner must type
    spoken_form  TEXT,            -- one real utterance: "le ministre" for "le/la ministre"
    tts_text     TEXT,            -- what the generated clip actually says
    phon_similarity REAL,         -- how much it sounds like its English; see phonetics.py
    gender       TEXT,
    ipa          TEXT,
    elides       INTEGER,         -- "l'hôpital" but "le héros"; see elision.py
    zipf         REAL,            -- inflection-aggregated
    zipf_lemma   REAL,
    freq_linear  REAL,            -- share of running text, for coverage stats
    similarity   REAL,
    best_english TEXT,
    tech_boost   REAL DEFAULT 1.0,
    rank_score   REAL,
    rank         INTEGER,
    level        INTEGER,
    is_core      INTEGER DEFAULT 0,   -- high-frequency word kept regardless of similarity
    is_swiss     INTEGER DEFAULT 0,   -- Helvetism (natel, septante)
    active       INTEGER DEFAULT 1,   -- still in the current ranking
    UNIQUE (lemma, pos)
);
CREATE INDEX IF NOT EXISTS idx_words_rank  ON words(rank);
CREATE INDEX IF NOT EXISTS idx_words_level ON words(level);

CREATE TABLE IF NOT EXISTS translations (
    id       INTEGER PRIMARY KEY,
    word_id  INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    english  TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    sense_index INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tr_word ON translations(word_id);

CREATE TABLE IF NOT EXISTS audio (
    id          INTEGER PRIMARY KEY,
    word_id     INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    path        TEXT,        -- local file under data/media, if fetched
    url         TEXT,
    region      TEXT,
    region_rank INTEGER,
    source      TEXT,        -- lingualibre | commons | tts
    is_primary  INTEGER DEFAULT 0,
    padded      INTEGER DEFAULT 0   -- leading silence added
);
CREATE INDEX IF NOT EXISTS idx_audio_word ON audio(word_id);

-- Per-direction scheduling state. Anki owns this for the Anki directions;
-- the web app owns it for walking mode. Both write back here.
CREATE TABLE IF NOT EXISTS card_state (
    word_id   INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    unlocked  INTEGER DEFAULT 0,
    reps      INTEGER DEFAULT 0,
    lapses    INTEGER DEFAULT 0,
    ivl       REAL DEFAULT 0,      -- days
    ease      REAL DEFAULT 2.5,
    due       INTEGER,             -- unix seconds
    last_rating INTEGER,
    source    TEXT,                -- anki | app
    PRIMARY KEY (word_id, direction)
);

CREATE TABLE IF NOT EXISTS reviews (
    id        INTEGER PRIMARY KEY,
    word_id   INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    rating    INTEGER NOT NULL,    -- 1 again, 2 hard, 3 good, 4 easy
    ms        INTEGER,
    source    TEXT
);
CREATE INDEX IF NOT EXISTS idx_rev_word ON reviews(word_id, direction);
CREATE INDEX IF NOT EXISTS idx_rev_ts   ON reviews(ts);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


# (table, column, DDL) applied when an older database is opened.
MIGRATIONS = [
    ("words", "active", "ALTER TABLE words ADD COLUMN active INTEGER DEFAULT 1"),
    ("words", "conjugation", "ALTER TABLE words ADD COLUMN conjugation TEXT"),
    ("words", "definitions", "ALTER TABLE words ADD COLUMN definitions TEXT"),
    ("audio", "padded", "ALTER TABLE audio ADD COLUMN padded INTEGER DEFAULT 0"),
    # Backfilled from what the cards teach today, because that is what the
    # clips on disk were made from. Run before the next build, it is exactly
    # right; run after one, it would call a stale clip fresh -- so the column
    # arrives with the migration rather than being filled in later.
    ("words", "tts_text", "ALTER TABLE words ADD COLUMN tts_text TEXT;"
                          "UPDATE words SET tts_text = type_answer"),
    ("words", "elides", "ALTER TABLE words ADD COLUMN elides INTEGER"),
    ("words", "spoken_form", "ALTER TABLE words ADD COLUMN spoken_form TEXT"),
    ("words", "phon_similarity", "ALTER TABLE words ADD COLUMN phon_similarity REAL"),
]


def _migrate(con: sqlite3.Connection) -> None:
    for table, column, ddl in MIGRATIONS:
        cols = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        if cols and column not in cols:
            con.executescript(ddl)


def connect(path: Path | str = DB_PATH) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    _migrate(con)
    con.commit()
    return con


def set_meta(con: sqlite3.Connection, key: str, value) -> None:
    con.execute("INSERT INTO meta(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def get_meta(con: sqlite3.Connection, key: str, default=None):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default
