"""The catalogue the app reads, and the progress it sends back.

This is the contract between the two halves of the project: the pipeline
writes these files and the TypeScript app parses them, field by field, with no
schema in between to complain if one side moves. So the shape is pinned here —
in the words of the app, which calls them `k`, `lvl`, `m` and `looks` — and
the export of one small catalogue is checked in under tests/fixtures/catalogue/,
where the app's own suites read it too. A field renamed on either side fails
both suites with the same file in the message.
"""
import json
import sqlite3

import pytest

from catalogue_fixture import FIXTURE_DIR, exported, seeded
from frcog.db import get_meta
from frcog.webexport import CATALOGUE_VERSION, export, import_reviews, word_key


@pytest.fixture()
def con(tmp_path) -> sqlite3.Connection:
    """The shared fixture: six words, a verb with a table, one recording gone,
    and one word the last rebuild dropped."""
    return seeded(tmp_path / "test.db")


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
    assert first["m"] == pytest.approx(0.004), "the share of running text"
    assert first["looks"] == 0.95, "which rung the word enters on is decided from this"
    assert first["sounds"] == 0.3
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
    assert nation["audio"] == "w1.mp3"
    assert nation["cue_audio"] == "w1-en.mp3", "the English cue has its own clip"
    assert nation["def"] == {"fr": ["Communauté humaine établie sur un territoire."],
                             "en": ["nation"]}
    assert words["parler|verb"]["en"] == ["to speak", "to talk"], "primary sense first"
    assert words["parler|verb"]["conj"]["examples"] == {
        "pres": [{"fr": "Nous parlons français.", "en": "We speak French.", "f": "parlons"}]}, (
        "a line of the table with a sentence")
    assert words["parler|verb"]["ex"] == [
        {"fr": "Il parle trop vite.", "en": "He talks too fast.", "f": "parle"}], (
        "a sentence for the cloze rung, with the form to blank")
    assert words["oubli|noun"]["audio"] == "gone.mp3", "a recording the server no longer has"


def test_only_the_words_still_in_the_ranking_are_exported(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    keys = {w["k"] for w in read(out, "index.json")["words"]}
    assert "galetas|noun" not in keys, "active=0 is a word the last rebuild dropped"
    assert not (out / "level-02.json").exists()


def test_the_meta_file_says_what_the_app_shows_before_anything_is_studied(con, tmp_path):
    out = export(con, tmp_path / "catalogue", log=lambda *_: None)
    meta = read(out, "meta.json")
    assert meta["words"] == 6
    assert meta["levels"] == [1]
    assert meta["verbs"] == 1
    assert meta["ceiling"] == pytest.approx(0.0165), "how far the whole catalogue reaches"
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


def test_the_checked_in_catalogue_is_what_export_writes_today(con, tmp_path):
    """The files under tests/fixtures/catalogue/ are read by the app's unit and
    browser suites as their catalogue. If the export changes shape on purpose,
    refresh them — `python tests/catalogue_fixture.py` — and the app's suites
    then say what they make of the new shape."""
    fresh = exported(con, tmp_path / "catalogue")
    checked_in = {p.name: json.loads(p.read_text()) for p in sorted(FIXTURE_DIR.glob("*.json"))}
    assert set(fresh) == set(checked_in), "the same files"
    for name in fresh:
        assert fresh[name] == checked_in[name], (
            f"{name} differs from tests/fixtures/catalogue/{name}; "
            "run `python tests/catalogue_fixture.py` if the change is meant")
