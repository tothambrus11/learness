"""Export the catalogue for the study app, and import its progress back.

Shaped for a phone that is offline in a gym:

* one small index, always loaded, so manual word entry can search the whole
  catalogue without downloading it
* one file per level, holding everything those words need including
  conjugation tables, so a level is a single fetch and a single cache entry
* words keyed by lemma and part of speech, never by row id, so rebuilding the
  catalogue cannot detach a word from its history
* the dictionary — every word the ranking passed over — in one file per first
  letter, fetched only when someone types that letter into the words screen,
  because it is bigger than the curriculum and almost none of it is ever wanted
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import time
import unicodedata
from pathlib import Path

from . import elision
from . import function
from . import sentences
from .audio import usable
from .config import (APP_DIR, DEFAULT, DIR_LISTEN_EN, DIR_LISTEN_FR, DIR_READ, DIR_RECALL,
                     DIRECTIONS, MEDIA, Config)
from .db import set_meta

CATALOGUE_VERSION = 1

#: Where a dictionary word is filed: its first letter, folded, and one shard
#: for everything that is not a plain letter. The app derives the same name
#: from what is typed into the search box, so a lookup is one fetch.
DICT_SHARDS = "abcdefghijklmnopqrstuvwxyz"
DICT_OTHER = "other"


def word_key(lemma: str, pos: str) -> str:
    """The identity of a word, stable across rebuilds."""
    return f"{lemma}|{pos}"


from .english import cue_text, short_translations as _short


class Recordings:
    """What the export may promise: the clips that are actually in the media
    directory the app serves from.

    The database says which file a word's clip is; this says whether it is
    there. They disagreed for 125 words after a rebuild whose new clips were
    made and never committed (#61): the catalogue named them, the server had
    never seen them, and every card for those words told the learner its
    recording could not be fetched. So a path the database holds is named in
    the catalogue only when the file is here, and what is not is written down.
    """

    def __init__(self, media: Path):
        self.media = media
        #: The files the database named that were not there, in the order
        #: they were asked for; the log names the first few.
        self.missing: list[str] = []

    def take(self, path: str | None) -> str | None:
        """The file name if it may be promised, else None."""
        if path is None:
            return None
        if usable(self.media / path):
            return path
        self.missing.append(path)
        return None


def _word_row(con: sqlite3.Connection, r: sqlite3.Row, full: bool,
              have: Recordings | None = None) -> dict:
    trs = [t["english"] for t in con.execute(
        "SELECT english FROM translations WHERE word_id=? ORDER BY is_primary DESC, sense_index",
        (r["id"],))]
    entry = {
        "k": word_key(r["lemma"], r["pos"]),
        "fr": r["display_form"],
        "en": _short(trs),
        "lvl": r["level"],
        # share of running text, so the app can show how much you can read
        # without loading every level file
        "m": round(r["freq_linear"] or 0.0, 8),
        # In the index too, because the session builder decides from the
        # index which rung a new word enters on, before its level is loaded.
        "looks": round(r["similarity"] or 0.0, 2),
    }
    if r["phon_similarity"] is not None:
        entry["sounds"] = round(r["phon_similarity"], 2)
    if not full:
        return entry
    have = have or Recordings(MEDIA)
    aud = con.execute(
        "SELECT path FROM audio WHERE word_id=? AND source='tts' AND path IS NOT NULL",
        (r["id"],)).fetchone()
    nat = con.execute(
        "SELECT path FROM audio WHERE word_id=? AND source NOT IN ('tts','tts-en') "
        "AND path IS NOT NULL ORDER BY region_rank LIMIT 1", (r["id"],)).fetchone()
    cue = con.execute(
        "SELECT path FROM audio WHERE word_id=? AND source='tts-en' AND path IS NOT NULL",
        (r["id"],)).fetchone()
    entry.update({
        "lemma": r["lemma"],
        "answer": r["type_answer"],
        "pos": r["pos"],
        "gender": r["gender"] or "",
        "ipa": r["ipa"] or "",
        "rank": r["rank"],
        "mass": round(r["freq_linear"], 10),
        # None is "no recording", which the app already copes with. A name
        # that is not on disk looks the same to the learner, after a failed
        # fetch and a note in the diagnostics.
        "audio": have.take(aud["path"] if aud else None),
        "native": have.take(nat["path"] if nat else None),
        # what the card says in English, and the Kokoro clip of exactly that
        "cue": cue_text(entry["en"]),
        "cue_audio": have.take(cue["path"] if cue else None),
    })
    # A sentence or two the word actually appears in, for the cloze rung. The
    # rung only opens for a word that has one, so this is also what decides
    # how far the written ladder goes.
    ex = sentences.sentences_for_word(con, r["id"])
    if ex:
        entry["ex"] = ex
    # What the word means, said rather than paired: a few French definitions
    # from the French Wiktionary, and the English glosses in full (the "en"
    # list above is shortened for the front of the card).
    defs = {}
    if r["definitions"]:
        try:
            defs["fr"] = json.loads(r["definitions"])
        except ValueError:
            pass
    if trs:
        defs["en"] = trs[:3]
    if defs:
        entry["def"] = defs
    if r["is_swiss"]:
        entry["swiss"] = True
    # A word that sounds as if it starts with a vowel and still refuses to
    # elide: "le héros", "les héros" with no liaison. It is the one property of
    # a French word that spelling never shows, so it travels as a flag rather
    # than being re-derived anywhere downstream.
    if r["elides"] == 0 and elision.first_sound(r["ipa"]) in ("vowel", "semivowel"):
        entry["aspire"] = True
    # The prepositions the word governs — "penser à", "avoir besoin de" —
    # written by hand in function.py and shown on the back of its cards.
    chunks = function.chunks_of(r["lemma"])
    if chunks:
        entry["chunks"] = chunks
    if r["conjugation"]:
        try:
            entry["conj"] = json.loads(r["conjugation"])
        except ValueError:
            pass
        else:
            entry["conj"]["examples"] = sentences.for_word(con, r["id"])
    return entry


def export(con: sqlite3.Connection, out_dir: Path | None = None, cfg: Config = DEFAULT,
           max_level: int | None = None, log=print, media: Path | None = None,
           recipe: str = "") -> Path:
    """Write the catalogue the app reads.

    `media` is the directory the app will serve recordings from — the one
    `app/static/media` points at, unless a test says otherwise. A recording
    the database names but that directory does not hold is left out of the
    catalogue, and the log says how many and which; the word is still
    exported, without a voice, rather than with a promise the server cannot
    keep.

    `recipe` is what the data was made from — the hash the pipeline records
    over every stage's recipe (`recipe.catalogue_hash`) — and it is the only
    thing written here that is not a function of the database. It stands
    where a timestamp used to: a catalogue that said when it was made differed
    on every export, so a regeneration could never find that it had nothing to
    do, and the files told nobody which code and which dumps they came from.
    Empty when the caller has nothing recorded. Everything else is written in
    an order the database fixes, so the same data gives the same bytes.
    """
    out_dir = Path(out_dir) if out_dir else APP_DIR / "static" / "catalogue"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    have = Recordings(Path(media) if media else MEDIA)

    where = "WHERE active=1" + (" AND level <= ?" if max_level else "")
    args = (max_level,) if max_level else ()
    rows = con.execute(f"SELECT * FROM words {where} ORDER BY rank", args).fetchall()

    index, by_level, ceiling = [], {}, 0.0
    for r in rows:
        index.append(_word_row(con, r, full=False))
        by_level.setdefault(r["level"], []).append(_word_row(con, r, full=True, have=have))
        ceiling += r["freq_linear"] or 0.0
    if have.missing:
        shown = ", ".join(have.missing[:5]) + (", …" if len(have.missing) > 5 else "")
        log(f"  recordings: {len(have.missing)} named in the database are not in "
            f"{have.media} and were left out: {shown}")

    # The function words: not ranked, so not in a level. They ride in the
    # index at the stage they belong to and in a file of their own, and a
    # catalogue whose corpus was never fetched still gets them, mined from the
    # sentences the database already holds.
    if not function.entries(con):
        log("  function words: no sentences yet, mining the examples already stored")
        function.attach(con, function.corpus_from_db(con), log=log)
    function_words = function.entries(con)
    index = function.interleave(index, function_words)

    def write(name: str, payload) -> int:
        path = out_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return path.stat().st_size

    total = write("index.json", {"v": CATALOGUE_VERSION, "words": index})
    for level, words in sorted(by_level.items()):
        total += write(f"level-{level:02d}.json", {"v": CATALOGUE_VERSION, "level": level,
                                                   "words": words})
    total += write("function.json", {"v": CATALOGUE_VERSION, "level": 0,
                                     "words": function_words})
    shards, table_letters, dict_bytes = _write_dictionary(con, {r["k"] for r in index}, write)
    total += dict_bytes
    meta = {
        "v": CATALOGUE_VERSION,
        "recipe": recipe,
        "levelSize": cfg.level_size,
        "levels": sorted(by_level),
        "words": len(rows),
        "functionWords": len(function_words),
        "verbs": sum(1 for ws in by_level.values() for w in ws if "conj" in w),
        "ceiling": round(ceiling, 8),
        "directions": DIRECTIONS,
        "examples": sentences.ATTRIBUTION,
    }
    if shards:
        # Absent rather than empty when no dictionary was built: the app reads
        # its absence as "this catalogue ships none" and says so, instead of
        # fetching a file that is not there.
        meta["dictionary"] = {"letters": sorted(shards), "words": sum(shards.values())}
        if table_letters:
            # The letters with a tables file, so the app fetches one only where
            # there is one: a letter with no verb has no file to 404 on.
            meta["dictionary"]["tables"] = table_letters
    total += write("meta.json", meta)
    log(f"  {len(rows)} words and {len(function_words)} function words, "
        f"{len(by_level)} level files -> {out_dir} "
        f"({total / 1e6:.1f} MB total, index {(out_dir / 'index.json').stat().st_size / 1e3:.0f} kB)")
    if shards:
        log(f"  dictionary:     {sum(shards.values())} words in {len(shards)} files, "
            "fetched a letter at a time")
    return out_dir


#: What a French article looks like in front of a headword, longest first. The
#: app's `splitArticle` reads the same list; a trailing space is what keeps
#: "les" out of "lessive".
_ARTICLES = ("le/la ", "la/le ", "un/une ", "une/un ", "de la ", "de l'", "les ", "des ",
             "du ", "le ", "la ", "un ", "une ", "l'", "se ", "s'")


def headword(word: str) -> str:
    """A word without the article it is written with: "l'un" is filed under u.

    Most headwords have none — the article is added for the card, not stored —
    but a few are the article: "l'un", "la plupart", "du coup". The app strips
    what was typed the same way before choosing a file, so if this did not, a
    word could be written to one file and looked for in another and never be
    found at all.
    """
    text = (word or "").strip()
    low = text.lower().replace("’", "'")
    for article in _ARTICLES:
        if low.startswith(article):
            return text[len(article):].strip()
    return text


def dict_shard(word: str) -> str:
    """Which file a dictionary word lives in: the first letter of the headword,
    accents folded.

    The app folds a search the same way, so typing "étable" reaches the same
    file as "etable" and one lookup is one fetch.
    """
    first = unicodedata.normalize("NFD", headword(word).lower())[:1]
    # `"" in "abc"` is True in Python, so the length is checked as well as the
    # membership: a word with no letters at all belongs in the other shard.
    return first if len(first) == 1 and first in DICT_SHARDS else DICT_OTHER


def _write_dictionary(con: sqlite3.Connection, taught: set[str], write,
                      ) -> tuple[dict[str, int], list[str], int]:
    """One file per letter, skipping anything the catalogue already teaches.

    A word in the curriculum is offered from there, with its audio and its
    place in the ranking; offering it twice would be two answers to one search
    and only one of them the good one.

    A verb's table goes in a file of its own per letter, `dict-conj-<letter>`,
    keyed by the word's key: a search reads the shard and never the tables,
    which are many times its size, and the app fetches a letter's tables only
    when a verb added from the dictionary is opened (#91). Returns the words
    per letter, the letters that have tables, and the bytes written.
    """
    try:
        columns = {r[1] for r in con.execute("PRAGMA table_info(dictionary)")}
        if not columns:
            return {}, [], 0           # a database built before the dictionary existed
        with_tables = "conjugation" in columns
        rows = con.execute(
            "SELECT lemma, pos, display, gender, ipa, english"
            + (", conjugation" if with_tables else "")
            + " FROM dictionary ORDER BY lemma, pos").fetchall()
    except sqlite3.OperationalError:
        return {}, [], 0
    by_shard: dict[str, list[dict]] = {}
    tables: dict[str, dict[str, dict]] = {}
    for r in rows:
        key = word_key(r["lemma"], r["pos"])
        if key in taught:
            continue
        entry = {"fr": r["display"], "en": json.loads(r["english"]), "pos": r["pos"]}
        if r["gender"]:
            entry["gender"] = r["gender"]
        if r["ipa"]:
            entry["ipa"] = r["ipa"]
        letter = dict_shard(r["lemma"])
        by_shard.setdefault(letter, []).append(entry)
        if with_tables and r["pos"] == "verb" and r["conjugation"]:
            tables.setdefault(letter, {})[key] = json.loads(r["conjugation"])
    written = 0
    for letter, words in by_shard.items():
        written += write(f"dict-{letter}.json",
                         {"v": CATALOGUE_VERSION, "letter": letter, "words": words})
    for letter, verbs in tables.items():
        written += write(f"dict-conj-{letter}.json",
                         {"v": CATALOGUE_VERSION, "letter": letter, "tables": verbs})
    return {letter: len(words) for letter, words in by_shard.items()}, sorted(tables), written


# The app's ladder rungs, as the directions this side keys its statistics on.
# A review row from before the ladder still carries the direction itself.
_RUNG_DIRECTION = {
    "recognise": DIR_READ, "say": DIR_READ,
    "write": DIR_RECALL, "use": DIR_RECALL,
    "hear": DIR_LISTEN_EN, "dictate": DIR_LISTEN_FR,
}


def _direction(app_direction: str) -> str | None:
    """'written/say' -> 'fr_en'; an old direction passes through; unknown is None."""
    if app_direction in DIRECTIONS:
        return app_direction
    _, _, rung = str(app_direction or "").partition("/")
    return _RUNG_DIRECTION.get(rung)


def import_reviews(con: sqlite3.Connection, path: Path, log=print) -> int:
    """Merge a progress export from the app.

    The app keys everything by lemma and part of speech; this resolves those to
    local row ids and ignores anything the current catalogue no longer contains.
    Its cards are rungs on a ladder; a retired rung is not the word's state.
    """
    data = json.loads(Path(path).read_text())
    ids = {word_key(r["lemma"], r["pos"]): r["id"]
           for r in con.execute("SELECT id, lemma, pos FROM words")}
    added = skipped = 0
    with con:
        for s in data.get("states", []):
            wid = ids.get(s.get("key", ""))
            direction = _direction(s.get("direction"))
            if wid is None:
                skipped += 1
                continue
            if direction is None or s.get("retired"):
                continue
            con.execute(
                """INSERT INTO card_state (word_id,direction,unlocked,reps,lapses,ivl,ease,due,source)
                   VALUES (?,?,1,?,?,?,?,?,'app')
                   ON CONFLICT(word_id,direction) DO UPDATE SET
                     reps=excluded.reps, lapses=excluded.lapses, ivl=excluded.ivl,
                     ease=excluded.ease, due=excluded.due, unlocked=1, source='app'""",
                (wid, direction, s.get("reps", 0), s.get("lapses", 0),
                 s.get("ivl", 0), s.get("ease", 2.5), s.get("due")))
        for r in data.get("reviews", []):
            wid = ids.get(r.get("key", ""))
            direction = _direction(r.get("direction"))
            if wid is None or direction is None:
                continue
            exists = con.execute(
                "SELECT 1 FROM reviews WHERE word_id=? AND direction=? AND ts=? AND source='app'",
                (wid, direction, r["ts"])).fetchone()
            if exists:
                continue
            con.execute(
                "INSERT INTO reviews (word_id,direction,ts,rating,ms,source) "
                "VALUES (?,?,?,?,?,'app')",
                (wid, direction, r["ts"], r["rating"], r.get("ms")))
            added += 1
        set_meta(con, "last_app_import", int(time.time()))
    log(f"  imported {added} new reviews"
        + (f", ignored {skipped} words not in this catalogue" if skipped else ""))
    return added
