"""Example sentences from the Tatoeba corpus, plus Wiktionary's own examples.

Two jobs:

* a couple of sentences for every word being taught
* one sentence per conjugated form, so a verb table is not just a paradigm but
  a set of things people actually say

Sentences are never written here. Everything comes from a real corpus, because
a made-up example sentence teaches made-up French. Where the corpus has nothing
for a rare form (the passé simple of an uncommon verb is genuinely absent from
ordinary speech), the cell simply stays empty and says so.

Tatoeba data is CC-BY 2.0 FR. Attribution travels with the cards.
"""
from __future__ import annotations

import bz2
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

from .config import DEFAULT, RAW, Config

BASE = "https://downloads.tatoeba.org/exports/per_language"
CORPUS_FILES = {
    "fra_sentences.tsv.bz2": f"{BASE}/fra/fra_sentences.tsv.bz2",
    "eng_sentences.tsv.bz2": f"{BASE}/eng/eng_sentences.tsv.bz2",
    "fra-eng_links.tsv.bz2": f"{BASE}/fra/fra-eng_links.tsv.bz2",
}
ATTRIBUTION = "Example sentences from Tatoeba (CC BY 2.0 FR)"

# What makes a sentence a good example rather than merely an occurrence.
MIN_TOKENS = 3
MAX_TOKENS = 14
MAX_CHARS = 120

_TOKEN = re.compile(r"[a-zà-öø-ÿœæ]+", re.IGNORECASE)


def tokenize(text: str) -> list[str]:
    """French words, lowercased. Elision splits: "l'ordinateur" -> l, ordinateur."""
    return _TOKEN.findall(text.lower())


def missing_files(raw: Path = RAW) -> list[str]:
    return [name for name in CORPUS_FILES if not (raw / name).exists()]


def _read_tsv_bz2(path: Path):
    with bz2.open(path, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            yield line.rstrip("\n").split("\t")


def load_pairs(raw: Path = RAW, log=print) -> list[tuple[str, str]]:
    """(French, English) sentence pairs, one English translation per French id."""
    fra: dict[str, str] = {}
    for row in _read_tsv_bz2(raw / "fra_sentences.tsv.bz2"):
        if len(row) >= 3:
            fra[row[0]] = row[2]
    log(f"    {len(fra)} French sentences")

    wanted_eng: dict[str, str] = {}      # eng id -> fra id (first link wins)
    for row in _read_tsv_bz2(raw / "fra-eng_links.tsv.bz2"):
        if len(row) >= 2 and row[0] in fra and row[1] not in wanted_eng:
            wanted_eng[row[1]] = row[0]
    log(f"    {len(wanted_eng)} French-English links")

    pairs: dict[str, str] = {}
    for row in _read_tsv_bz2(raw / "eng_sentences.tsv.bz2"):
        if len(row) >= 3 and row[0] in wanted_eng:
            fid = wanted_eng[row[0]]
            if fid not in pairs:
                pairs[fid] = row[2]
    out = [(fra[fid], en) for fid, en in pairs.items()]
    log(f"    {len(out)} usable sentence pairs")
    return out


def build_index(pairs: list[tuple[str, str]]) -> tuple[list, dict]:
    """Keep only sentences worth showing, and index them by the words they contain."""
    kept: list[tuple[str, str, int]] = []
    index: dict[str, list[int]] = defaultdict(list)
    for fr, en in pairs:
        if len(fr) > MAX_CHARS or not en:
            continue
        toks = tokenize(fr)
        if not (MIN_TOKENS <= len(toks) <= MAX_TOKENS):
            continue
        i = len(kept)
        kept.append((fr, en, len(toks)))
        for t in set(toks):
            index[t].append(i)
    return kept, index


def _pick(index: dict, kept: list, token: str, used: set[int], limit: int) -> list[int]:
    """Shortest matching sentences first: a short sentence is a better example."""
    ids = index.get(token.lower())
    if not ids:
        return []
    ranked = sorted((i for i in ids if i not in used), key=lambda i: kept[i][2])
    return ranked[:limit]


SCHEMA = """
CREATE TABLE IF NOT EXISTS examples (
    id      INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    form    TEXT,      -- NULL for a word-level example, else the conjugated form
    slot    TEXT,      -- which conjugation cell, e.g. "pres:3"
    fr      TEXT NOT NULL,
    en      TEXT NOT NULL,
    source  TEXT NOT NULL,
    n       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ex_word ON examples(word_id);
CREATE INDEX IF NOT EXISTS idx_ex_slot ON examples(word_id, slot);
"""
