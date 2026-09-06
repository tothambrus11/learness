"""Definitions in French, from the French Wiktionary, for the back of a card.

The English Wiktionary gives every word a gloss — "bug", "to be located" —
which is a translation, and a translation is not what a dictionary says. The
French Wiktionary defines the word in French: "Petit insecte…", "Interpréter
des informations écrites…". That is a sentence of French per card, about a
word the learner has just met, which is the cheapest reading input the deck
can offer and the only place a word is explained rather than paired.

The extract is kaikki.org's, 3 GB, streamed once; only the deck's own
(lemma, part of speech) pairs are kept, and of each entry the first few sense
lines that define rather than point elsewhere.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .config import FRWIKT_PATH

PER_WORD = 3
MAX_CHARS = 220

# A sense that only names another form is not a definition.
POINTER_TAGS = {"form-of", "alt-of", "inflection-of", "plural", "feminine", "misspelling"}


def clean(gloss: str) -> str:
    """One definition line, trimmed to a sentence's worth. A very long gloss is
    cut at the first full stop past the limit, so it ends where a sentence does."""
    text = " ".join((gloss or "").split())
    if len(text) <= MAX_CHARS:
        return text
    stop = text.find(". ", MAX_CHARS // 2)
    return text[: stop + 1] if 0 < stop < MAX_CHARS * 1.5 else text[:MAX_CHARS].rstrip() + "…"


def senses_of(entry: dict) -> list[str]:
    """The defining senses of one extract line, first ones first, no repeats."""
    out: list[str] = []
    seen: set[str] = set()
    for s in entry.get("senses") or []:
        if set(s.get("tags") or []) & POINTER_TAGS or s.get("form_of") or s.get("alt_of"):
            continue
        for g in s.get("glosses") or []:
            line = clean(g)
            key = line.lower()
            if line and key not in seen:
                seen.add(key)
                out.append(line)
                break            # one line per sense
        if len(out) >= PER_WORD:
            break
    return out


def scan(path: Path, wanted: set[tuple[str, str]], log=print) -> dict[tuple[str, str], list[str]]:
    """Stream the extract once, keeping definitions for the pairs asked for.

    Several lines can share a (word, pos) — one per etymology — and they are
    taken in file order until the word has its few."""
    found: dict[tuple[str, str], list[str]] = {}
    lemmas = {w for w, _ in wanted}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            # The word is near the start of every line; a cheap check before
            # parsing three gigabytes of JSON.
            if '"word": "' not in line[:200]:
                continue
            head = line.find('"word": "') + 9
            word = line[head:line.find('"', head)]
            if word not in lemmas:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("lang_code") != "fr":
                continue
            key = (d.get("word"), d.get("pos"))
            if key not in wanted:
                continue
            have = found.setdefault(key, [])
            for s in senses_of(d):
                if len(have) >= PER_WORD:
                    break
                if s.lower() not in {h.lower() for h in have}:
                    have.append(s)
    log(f"  definitions:    {sum(1 for v in found.values() if v)} of {len(wanted)} words "
        f"defined in French")
    return found


def attach(con: sqlite3.Connection, path: Path = FRWIKT_PATH, log=print) -> int:
    """Store French definitions on every active word. Returns how many got one."""
    if not path.exists():
        log(f"  definitions:    none; {path.name} not downloaded (see frcog fetch)")
        return 0
    rows = con.execute("SELECT id, lemma, pos FROM words WHERE active=1").fetchall()
    wanted = {(r["lemma"], r["pos"]) for r in rows}
    found = scan(path, wanted, log=log)
    n = 0
    with con:
        for r in rows:
            defs = found.get((r["lemma"], r["pos"]))
            con.execute("UPDATE words SET definitions=? WHERE id=?",
                        (json.dumps(defs, ensure_ascii=False) if defs else None, r["id"]))
            n += bool(defs)
    return n
