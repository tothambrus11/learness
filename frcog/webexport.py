"""Export the catalogue for the study app, and import its progress back.

Shaped for a phone that is offline in a gym:

* one small index, always loaded, so manual word entry can search the whole
  catalogue without downloading it
* one file per level, holding everything those words need including
  conjugation tables, so a level is a single fetch and a single cache entry
* words keyed by lemma and part of speech, never by row id, so rebuilding the
  catalogue cannot detach a word from its history
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import time
from pathlib import Path

from . import elision
from . import sentences
from .config import (APP_DIR, DEFAULT, DIR_LISTEN_EN, DIR_LISTEN_FR, DIR_READ, DIR_RECALL,
                     DIRECTIONS, Config)
from .db import set_meta

CATALOGUE_VERSION = 1


def word_key(lemma: str, pos: str) -> str:
    """The identity of a word, stable across rebuilds."""
    return f"{lemma}|{pos}"


from .english import cue_text, short_translations as _short


def _word_row(con: sqlite3.Connection, r: sqlite3.Row, full: bool) -> dict:
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
        "audio": aud["path"] if aud else None,
        "native": nat["path"] if nat else None,
        # what the walk says in English, and the Kokoro clip of exactly that
        "cue": cue_text(entry["en"]),
        "cue_audio": cue["path"] if cue else None,
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
    if r["conjugation"]:
        try:
            entry["conj"] = json.loads(r["conjugation"])
        except ValueError:
            pass
        else:
            entry["conj"]["examples"] = sentences.for_word(con, r["id"])
    return entry


def export(con: sqlite3.Connection, out_dir: Path | None = None, cfg: Config = DEFAULT,
           max_level: int | None = None, log=print) -> Path:
    out_dir = Path(out_dir) if out_dir else APP_DIR / "static" / "catalogue"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    where = "WHERE active=1" + (" AND level <= ?" if max_level else "")
    args = (max_level,) if max_level else ()
    rows = con.execute(f"SELECT * FROM words {where} ORDER BY rank", args).fetchall()

    index, by_level, ceiling = [], {}, 0.0
    for r in rows:
        index.append(_word_row(con, r, full=False))
        by_level.setdefault(r["level"], []).append(_word_row(con, r, full=True))
        ceiling += r["freq_linear"] or 0.0

    def write(name: str, payload) -> int:
        path = out_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return path.stat().st_size

    total = write("index.json", {"v": CATALOGUE_VERSION, "words": index})
    for level, words in sorted(by_level.items()):
        total += write(f"level-{level:02d}.json", {"v": CATALOGUE_VERSION, "level": level,
                                                   "words": words})
    total += write("meta.json", {
        "v": CATALOGUE_VERSION,
        "generated": int(time.time()),
        "levelSize": cfg.level_size,
        "levels": sorted(by_level),
        "words": len(index),
        "verbs": sum(1 for ws in by_level.values() for w in ws if "conj" in w),
        "ceiling": round(ceiling, 8),
        "directions": DIRECTIONS,
        "examples": sentences.ATTRIBUTION,
    })
    log(f"  {len(index)} words, {len(by_level)} level files -> {out_dir} "
        f"({total / 1e6:.1f} MB total, index {(out_dir / 'index.json').stat().st_size / 1e3:.0f} kB)")
    return out_dir


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
