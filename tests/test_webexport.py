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

from catalogue_fixture import FIXTURE_DIR, MISSING_CLIP, RECIPE, exported, media_for, seeded
from frcog import webexport
from frcog.db import get_meta
from frcog.webexport import CATALOGUE_VERSION, export, import_reviews, word_key


@pytest.fixture()
def con(tmp_path) -> sqlite3.Connection:
    """The shared fixture: six words, a verb with a table, one recording gone,
    and one word the last rebuild dropped."""
    return seeded(tmp_path / "test.db")


def export_of(con: sqlite3.Connection, tmp_path, log=lambda *_: None, out="catalogue"):
    """The export of the fixture, with every recording it names on disk — the
    export promises only what it can see, so a test of the shape lays the
    files out first."""
    return export(con, tmp_path / out, log=log, media=media_for(con, tmp_path / "media"),
                  recipe=RECIPE)


def read(out, name: str) -> dict:
    return json.loads((out / name).read_text())


def test_the_index_carries_what_a_session_is_built_from(con, tmp_path):
    out = export_of(con, tmp_path)
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
    out = export_of(con, tmp_path)
    words = {w["k"]: w for w in read(out, "level-01.json")["words"]}
    nation = words["nation|noun"]
    assert nation["answer"] == "la nation", "what a typed answer is graded against"
    assert nation["lemma"] == "nation"
    assert nation["pos"] == "noun"
    assert nation["gender"] == "f"
    assert nation["ipa"] == "/na.sjɔ̃/"
    assert nation["cue"] == "nation", "what the card says in English"
    assert nation["audio"] == "w1.mp3"
    assert nation["cue_audio"] == "w1-en.mp3", "the English cue has its own clip"
    assert nation["def"] == {"fr": ["Communauté humaine établie sur un territoire."],
                             "en": ["nation"]}
    assert words["parler|verb"]["en"] == ["to speak", "to talk"], "primary sense first"
    assert words["parler|verb"]["conj"]["examples"] == {
        "imp": [{"fr": "Il parlait doucement.", "en": "He was speaking softly.", "f": "parlait",
                 "id": 1003}],
        "pc": [{"fr": "Elle a parlé au directeur.", "en": "She spoke to the manager.", "f": "a parlé",
                "id": 1002}],
        "pres": [{"fr": "Nous parlons français.", "en": "We speak French.", "f": "parlons",
                  "id": 1001}]}, (
        "a line of the table with a sentence, and one in each past tense, each with the "
        "corpus's own id so the app can keep a learner's history by it across rebuilds")
    assert words["parler|verb"]["chunks"] == [
        {"fr": "parler de qch", "en": "to talk about something"},
        {"fr": "parler à qn", "en": "to talk to someone"},
    ], "what the verb governs rides on the verb"
    assert "chunks" not in words["nation|noun"], "absent, not empty, where there is none"
    assert words["parler|verb"]["ex"] == [
        {"fr": "Il parle trop vite.", "en": "He talks too fast.", "f": "parle", "id": 1004}], (
        "a sentence for the cloze rung, with the form to blank")
    assert words["oubli|noun"]["audio"] == MISSING_CLIP, (
        "on disk at export time, so promised; the browser suite's server is the one without it")


def test_a_recording_that_is_not_on_disk_is_not_promised_to_the_app(con, tmp_path):
    """After a rebuild on 6 Sep 2026 the catalogue named 250 clips — new ids,
    synthesised on one machine and never committed — and the app reported
    "recordings could not be fetched" on every screen for the words it met
    (#61). The export used to trust the audio table; now it looks."""
    media = media_for(con, tmp_path / "media")
    (media / "w1.mp3").unlink()                      # nation's French clip
    (media / "w2-en.mp3").write_bytes(b"ID3")        # jour's cue: a header and nothing else
    lines = []
    out = export(con, tmp_path / "catalogue", log=lines.append, media=media)
    words = {w["k"]: w for w in read(out, "level-01.json")["words"]}
    assert words["nation|noun"]["audio"] is None, "not there, so not named"
    assert words["nation|noun"]["cue_audio"] == "w1-en.mp3", "its cue is there, so it is"
    assert words["jour|noun"]["cue_audio"] is None, "a file too small to be a clip is not one"
    assert words["jour|noun"]["audio"] == "w2.mp3"
    assert words["parler|verb"]["audio"] == "w5.mp3", "the rest are untouched"
    said = [l for l in lines if "recordings" in l]
    assert said and "2 named in the database are not in" in said[0], "the export says so"
    assert "w1.mp3" in said[0] and "w2-en.mp3" in said[0], "and names them"


def test_an_export_with_every_recording_in_place_says_nothing_about_them(con, tmp_path):
    lines = []
    export_of(con, tmp_path, log=lines.append)
    assert not [l for l in lines if "recordings" in l]


def test_only_the_words_still_in_the_ranking_are_exported(con, tmp_path):
    out = export_of(con, tmp_path)
    keys = {w["k"] for w in read(out, "index.json")["words"]}
    assert "galetas|noun" not in keys, "active=0 is a word the last rebuild dropped"
    assert not (out / "level-02.json").exists()


def test_the_meta_file_says_what_the_app_shows_before_anything_is_studied(con, tmp_path):
    out = export_of(con, tmp_path)
    meta = read(out, "meta.json")
    assert meta["words"] == 6
    assert meta["levels"] == [1]
    assert meta["verbs"] == 1
    assert meta["ceiling"] == pytest.approx(0.0165), "how far the whole catalogue reaches"
    assert meta["recipe"] == RECIPE, "what it was made from, not when"
    assert meta["examples"], "the sentences are attributed"


def test_the_same_data_exports_to_the_same_bytes(con, tmp_path):
    """A regeneration has to be able to find that it changed nothing. The
    catalogue used to carry the time it was written, so every export was a
    diff of every file, and "did this rebuild change the deck?" could only be
    answered by reading the diff around the timestamp."""
    first = export_of(con, tmp_path, out="first")
    second = export_of(con, tmp_path, out="second")
    assert sorted(p.name for p in first.iterdir()) == sorted(p.name for p in second.iterdir())
    for path in first.iterdir():
        assert path.read_bytes() == (second / path.name).read_bytes(), path.name


def test_an_export_replaces_the_last_one_rather_than_layering_on_it(con, tmp_path):
    out = export_of(con, tmp_path)
    (out / "level-09.json").write_text("{}")
    export_of(con, tmp_path)
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


def test_the_dictionary_ships_a_file_per_letter(con, tmp_path):
    """Every word the ranking passed over, for the words screen to fill a form
    from. One file per first letter because it is far bigger than the
    curriculum and almost none of it is ever wanted: a lookup is one fetch."""
    out = export_of(con, tmp_path)
    shard = read(out, "dict-c.json")
    assert shard["v"] == CATALOGUE_VERSION
    assert shard["letter"] == "c"
    assert shard["words"] == [{"fr": "la chaussette", "en": ["sock"], "pos": "noun",
                               "gender": "f", "ipa": "/ʃo.sɛt/"}]
    assert read(out, "dict-p.json")["words"][0]["fr"] == "plonger", \
        "a verb has no article, and no gender to leave out"
    assert "gender" not in read(out, "dict-p.json")["words"][0]


def test_a_word_the_catalogue_teaches_is_not_offered_twice(con, tmp_path):
    """"jour" is in the dictionary and in the curriculum. The curriculum's has
    audio and a place in the ranking; two answers to one search, one of them
    worse, is not an improvement."""
    out = export_of(con, tmp_path)
    assert not (out / "dict-j.json").exists()
    letters = read(out, "meta.json")["dictionary"]["letters"]
    assert letters == ["c", "p", "u"]


def test_a_catalogue_with_no_dictionary_says_nothing_about_one(con, tmp_path):
    """Built before the dictionary existed, or built without the extract. The
    app reads the absence as "this catalogue ships none" rather than fetching a
    file that is not there."""
    con.execute("DELETE FROM dictionary")
    out = export_of(con, tmp_path)
    assert "dictionary" not in read(out, "meta.json")
    assert not list(out.glob("dict-*.json"))


def test_a_dictionary_word_is_filed_under_its_folded_first_letter():
    assert webexport.dict_shard("Étable") == "e", "accents are folded, as the search folds them"
    assert webexport.dict_shard("chat") == "c"
    assert webexport.dict_shard("œuf") == "other", "and anything that is not a letter has a home"
    assert webexport.dict_shard("") == "other"


def test_a_headword_written_with_an_article_is_filed_under_the_word(con, tmp_path):
    """"l'un" is filed under u, because the app strips the article from what was
    typed before it picks a file. If the two disagreed the word would be written
    to one file, looked for in another, and never found."""
    assert webexport.dict_shard("l'un") == "u"
    assert webexport.dict_shard("la plupart") == "p"
    assert webexport.dict_shard("du coup") == "c"
    assert webexport.dict_shard("lessive") == "l", "a trailing space keeps les out of lessive"
    out = export_of(con, tmp_path)
    assert [w["fr"] for w in read(out, "dict-u.json")["words"]] == ["l'un"]


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
