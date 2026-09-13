"""The catalogue the app reads, and the progress it sends back.

This is the contract between the two halves of the project: the pipeline
writes these files and the TypeScript app parses them, field by field, with no
schema in between to complain if one side moves. So the shape is pinned here —
in the words of the app, which calls them `k`, `lvl`, `m` and `looks`.
"""
import json
import sqlite3

import pytest

from frcog.db import connect, get_meta
from frcog.webexport import CATALOGUE_VERSION, export, import_reviews, word_key


@pytest.fixture()
def con(tmp_path) -> sqlite3.Connection:
    """A database of two words: one cognate noun and one verb that is not."""
    c = connect(tmp_path / "test.db")
    with c:
        c.execute(
            """INSERT INTO words (id, lemma, pos, display_form, type_answer, gender, ipa,
                 zipf, freq_linear, similarity, phon_similarity, rank, level, active)
               VALUES (1,'nation','noun','la nation','la nation','f','/na.sjɔ̃/',
                 4.5, 0.0004, 0.98, 0.31, 1, 1, 1)""")
        c.execute(
            """INSERT INTO words (id, lemma, pos, display_form, type_answer, gender, ipa,
                 zipf, freq_linear, similarity, phon_similarity, rank, level, active)
               VALUES (2,'faire','verb','faire','faire','', '/fɛʁ/',
                 6.1, 0.004, 0.20, 0.10, 2, 1, 1)""")
        c.execute(
            """INSERT INTO words (id, lemma, pos, display_form, type_answer, zipf,
                 freq_linear, similarity, rank, level, active)
               VALUES (3,'galetas','noun','le galetas','le galetas', 2.0, 1e-7, 0.1, 3, 2, 0)""")
        c.executemany(
            "INSERT INTO translations (word_id, english, is_primary, sense_index) VALUES (?,?,?,?)",
            [(1, 'nation', 1, 0), (2, 'to do', 1, 0), (2, 'to make', 0, 1)])
    return c


def read(out, name: str) -> dict:
    return json.loads((out / name).read_text())


def test_the_index_carries_what_a_session_is_built_from(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    index = read(out, "index.json")
    assert index["v"] == CATALOGUE_VERSION
    first = index["words"][0]
    assert first["k"] == "nation|noun", "lemma and part of speech, never a row id"
    assert first["fr"] == "la nation"
    assert first["en"] == ["nation"]
    assert first["lvl"] == 1
    assert first["m"] == pytest.approx(0.0004), "the share of running text"
    assert first["looks"] == 0.98, "which rung the word enters on is decided from this"
    assert first["sounds"] == 0.31
    assert "ipa" not in first, "the index stays small: the rest is in the level file"


def test_a_level_file_carries_everything_a_card_needs(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    words = {w["k"]: w for w in read(out, "level-01.json")["words"]}
    nation = words["nation|noun"]
    assert nation["answer"] == "la nation", "what a typed answer is graded against"
    assert nation["lemma"] == "nation"
    assert nation["pos"] == "noun"
    assert nation["gender"] == "f"
    assert nation["ipa"] == "/na.sjɔ̃/"
    assert nation["cue"] == "nation", "what the walk says in English"
    assert nation["audio"] is None, "no clip recorded for it yet"
    assert words["faire|verb"]["en"] == ["to do", "to make"], "primary sense first"


def test_only_the_words_still_in_the_ranking_are_exported(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    keys = {w["k"] for w in read(out, "index.json")["words"]}
    assert "galetas|noun" not in keys, "active=0 is a word the last rebuild dropped"
    assert not (out / "level-02.json").exists()


def test_the_meta_file_says_what_the_app_shows_before_anything_is_studied(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    meta = read(out, "meta.json")
    assert meta["words"] == 2
    assert meta["levels"] == [1]
    assert meta["ceiling"] == pytest.approx(0.0044), "how far the whole catalogue reaches"
    assert meta["generated"] > 0
    assert meta["examples"], "the sentences are attributed"


def test_an_export_replaces_the_last_one_rather_than_layering_on_it(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    (out / "level-09.json").write_text("{}")
    export(con, tmp_path / "catalogue", log=lambda *_: None)
    assert not (out / "level-09.json").exists()


def test_progress_comes_back_by_word_key_and_ignores_what_is_no_longer_here(con, tmp_path):
    path = tmp_path / "progress.json"
    path.write_text(json.dumps({
        "states": [
            {"key": "nation|noun", "direction": "written/recognise", "reps": 4, "lapses": 1,
             "ivl": 12, "ease": 2.3, "due": 1700000000},
            {"key": "nation|noun", "direction": "written/say", "retired": True, "reps": 9},
            {"key": "gone|noun", "direction": "written/recognise", "reps": 3},
        ],
        "reviews": [
            {"key": "nation|noun", "direction": "written/recognise", "ts": 1700000000,
             "rating": 3, "ms": 2500},
            {"key": "gone|noun", "direction": "written/recognise", "ts": 1700000001, "rating": 3},
        ],
    }))
    added = import_reviews(con, path, log=lambda *_: None)
    assert added == 1, "the review of a word this catalogue no longer has is dropped"

    states = con.execute("SELECT word_id, direction, reps FROM card_state").fetchall()
    assert [tuple(s) for s in states] == [(1, "fr_en", 4)], (
        "a retired rung is not the word's state, and 'written/recognise' is this side's 'fr_en'")

    again = import_reviews(con, path, log=lambda *_: None)
    assert again == 0, "importing the same file twice is not twice the studying"
    assert get_meta(con, "last_app_import"), "and the import is dated"


def test_a_word_key_is_the_same_string_on_both_sides():
    assert word_key("bug", "noun") == "bug|noun"
