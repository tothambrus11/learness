"""Every French word the extract has an English gloss for, ranked or not.

The catalogue is a curriculum: five thousand words chosen and ordered so that
the cheapest useful ones come first. That is the right answer to "what should I
learn next" and no answer at all to "my tutor said this word today" — which is
what the words screen is for. Adding one meant typing its English, its part of
speech and its gender from memory, and a word typed from memory is a card that
teaches whatever was remembered.

So the same extract that feeds the ranking is read a second time for everything
the ranking passed over, and what it keeps is only what a form needs filling in
with: the word as a card would show it, its glosses, its part of speech, its
gender and its IPA. No frequency, no similarity, no audio, no level — none of
that means anything about a word nobody chose to teach. It is a dictionary, not
a syllabus.

The elision question ("le héros" against "l'hôtel") is asked here without the
corpus count and without the network: a hundred thousand words cannot be looked
up one at a time. Where nothing answers it, the word is offered without an
article rather than with a guessed one — the learner is looking at the word and
can say which it is, and the app lets them correct it.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable, Iterator

from . import elision
from .build import article
from .config import DEFAULT, KAIKKI_PATH, Config
from .english import short_translations
from .kaikki import Entry, iter_entries

#: How many senses a dictionary entry carries. The form shows them all, so this
#: is a line on a screen, not a dictionary page.
GLOSSES = 3

#: A row as it is stored and exported.
COLUMNS = ("lemma", "pos", "display", "gender", "ipa", "english")


def display_form(entry: Entry) -> str:
    """What a card would show: a noun with its article, everything else bare.

    A noun whose elision nothing settles keeps its bare form. The article is
    the gender and the gender is the point, so a wrong one is worse than none:
    the app writes "(m/f)" beside a word of either gender and lets a word of
    your own be corrected, and both are better than teaching "le hôtel".
    """
    if entry.pos != "noun" or entry.gender not in {"m", "f", "mf"}:
        return entry.word
    verdict = elision.resolve(entry.word, entry.ipa, entry.h_class, None, None)
    if not verdict.known:
        return entry.word
    art = article(entry.gender, verdict.elides)
    return f"{art}{entry.word}" if art.endswith("'") else f"{art} {entry.word}"


def row(entry: Entry) -> tuple | None:
    """One entry as it is stored, or None for one there is nothing to say about.

    A word with no English gloss is not a dictionary entry — it is a headword
    the extract carries for some other language's sake — and a card made from
    one could not be asked in either direction.
    """
    glosses = short_translations([g for g in entry.glosses if g.strip()])[:GLOSSES]
    if not entry.word or not glosses:
        return None
    return (entry.word, entry.pos, display_form(entry), entry.gender or "",
            entry.ipa or "", json.dumps(glosses, ensure_ascii=False))


def rows(entries: Iterable[Entry]) -> Iterator[tuple]:
    for entry in entries:
        r = row(entry)
        if r is not None:
            yield r


def build(con: sqlite3.Connection, kaikki_path: Path = KAIKKI_PATH, cfg: Config = DEFAULT,
          log=print) -> int:
    """Read the extract and write the dictionary table. Returns how many words.

    Replaces whatever was there: the extract is the only source, so a rebuild
    is the whole answer and a merge would only keep words a newer dump dropped.
    """
    con.execute("DELETE FROM dictionary")
    written = 0
    batch: list[tuple] = []
    for r in rows(iter_entries(kaikki_path, cfg)):
        batch.append(r)
        if len(batch) >= 5000:
            written += _flush(con, batch)
            batch = []
    written += _flush(con, batch)
    con.commit()
    log(f"  dictionary:     {written} words -> the words screen can fill a form from any of them")
    return written


def _flush(con: sqlite3.Connection, batch: list[tuple]) -> int:
    if not batch:
        return 0
    con.executemany(
        f"INSERT OR REPLACE INTO dictionary ({','.join(COLUMNS)}) VALUES (?,?,?,?,?,?)", batch)
    return len(batch)


def count(con: sqlite3.Connection) -> int:
    """How many words are in the dictionary, for a caller that wants to say."""
    return con.execute("SELECT COUNT(*) FROM dictionary").fetchone()[0]
