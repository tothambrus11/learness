"""The audio step says what it could not make.

A word whose clip fails to synthesise ships without a voice, and the card
copes with that; what it must not do is fail quietly. Until #61 the run's
summary counted the clips it had and not the ones it had not, so a refused
word was found by the learner, on a card, as "recording could not be fetched".
The network itself is out of reach here: edge-tts and Wikimedia are stood in
for by fakes that fail the way they fail.
"""
from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest

from catalogue_fixture import seeded
from frcog import audio
from frcog.audio import MIN_BYTES, fetch_human, synthesize_missing, tts_filename, usable
from frcog.config import Config


@pytest.fixture()
def con(tmp_path, monkeypatch) -> sqlite3.Connection:
    """The fixture database, with the media directory pointed at a temporary one."""
    monkeypatch.setattr(audio, "MEDIA", tmp_path / "media")
    return seeded(tmp_path / "test.db")


def quiet() -> Config:
    """No leading silence: padding shells out to ffmpeg, which is not the point here."""
    cfg = Config()
    cfg.lead_silence_ms = 0
    cfg.audio_concurrency = 2
    return cfg


class FakeVoice:
    """edge-tts, as it behaves on a bad day: one phrase it refuses outright,
    one it hands back a header for and nothing else, the rest it says."""

    refuse = "le pont"
    truncate = "le train"

    def __init__(self, text: str, voice: str, rate: str = "+0%"):
        self.text = text

    async def save(self, path: str) -> None:
        if self.text == self.refuse:
            raise RuntimeError("voice refused the request")
        size = 3 if self.text == self.truncate else MIN_BYTES + 100
        with open(path, "wb") as fh:
            fh.write(b"\0" * size)


def test_a_clip_that_could_not_be_made_is_named_with_its_reason(con, monkeypatch):
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=FakeVoice))
    monkeypatch.setattr(audio.asyncio, "sleep", _no_sleep)
    lines = []
    made = synthesize_missing(con, quiet(), log=lines.append)

    refused = [l for l in lines if "'le pont'" in l]
    assert refused and "RuntimeError: voice refused the request" in refused[0], (
        "which word, and what the voice said")
    truncated = [l for l in lines if "'le train'" in l]
    assert truncated and "no clip written" in truncated[0]
    assert any("2 of 7 could not be made" in l for l in lines), "counted in the summary"
    assert made.have == 5


def test_a_word_whose_clip_failed_has_no_row_and_no_half_file(con, monkeypatch):
    """A row for a file that is not there is the promise the export used to
    keep; a three-byte file would have counted as a clip on the next run."""
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=FakeVoice))
    monkeypatch.setattr(audio.asyncio, "sleep", _no_sleep)
    synthesize_missing(con, quiet(), log=lambda *_: None)
    ids = {r["display_form"]: r["id"] for r in con.execute("SELECT id, display_form FROM words")}
    media = audio.media_dir()
    for text in (FakeVoice.refuse, FakeVoice.truncate):
        assert not (media / tts_filename(ids[text])).exists(), f"nothing left behind for {text}"
        assert con.execute("SELECT COUNT(*) FROM audio WHERE word_id=? AND source='tts'",
                           (ids[text],)).fetchone()[0] == 0
    assert usable(media / tts_filename(ids["la nation"]))
    assert con.execute("SELECT path FROM audio WHERE word_id=? AND source='tts'",
                       (ids["la nation"],)).fetchone()[0] == tts_filename(ids["la nation"])


def test_a_native_recording_that_would_not_download_is_named_with_what_the_server_said(
        con, monkeypatch):
    with con:
        con.executemany(
            "INSERT INTO audio (word_id, url, region, region_rank, source) VALUES (?,?,?,?,?)",
            [(1, "https://commons/nation.ogg", "Switzerland", 0, "lingualibre"),
             (2, "https://commons/parler.ogg", "France", 1, "commons")])

    def fake_download(args):
        row_id, word_id, url, dest = args
        if "parler" in url:
            return row_id, None, "HTTP 404"
        dest.write_bytes(b"\0" * (MIN_BYTES + 1))
        return row_id, dest.name, ""

    monkeypatch.setattr(audio, "_download", fake_download)
    lines = []
    ok = fetch_human(con, quiet(), log=lines.append)
    assert ok == 1
    gone = [l for l in lines if "parler.ogg" in l]
    assert gone and "HTTP 404" in gone[0], "the url and what Wikimedia answered"
    assert any("1 of 2 could not be fetched" in l for l in lines)
    assert con.execute("SELECT path FROM audio WHERE word_id=2 AND source='commons'"
                       ).fetchone()[0] is None, "no path, so the export names nothing"


async def _no_sleep(_seconds: float) -> None:
    """The retry back-off, without the waiting."""


def _synthetic_clip(path, frames: int) -> None:
    """An mp3 of `frames` 24 ms frames, as the cutter reads them."""
    from test_mp3 import frame, id3
    path.write_bytes(id3() + frame() * frames)


def test_a_clip_with_a_second_of_silence_before_the_voice_is_cut_to_the_margin(tmp_path):
    """The bug this exists for (#68): edge-tts leaves over a second of
    silence before the word and another after it, and the pipeline added
    300 ms more. A play button that starts a second and a half late feels
    broken, and the delay was in the file, not in the player."""
    from frcog.audio import settle_edges
    from frcog.mp3 import duration_ms
    cfg = Config()
    cfg.lead_silence_ms = 150
    cfg.tail_silence_ms = 150
    clip = tmp_path / "frcog-1.mp3"
    _synthetic_clip(clip, 125)                     # 3000 ms
    before = duration_ms(clip.read_bytes())
    # ffmpeg is stood in for: it heard 1170 ms of silence, then the word, then 1080 ms.
    assert settle_edges(clip, cfg, edges=lambda _p: (1170.0, 1080.0))
    after = duration_ms(clip.read_bytes())
    # 1020 ms off the front is 42 frames (1008 ms), 930 ms off the back is 38 (912 ms):
    # a whole frame is kept rather than half of one, so the margin is at least 150 ms.
    assert before - after == (42 + 38) * 24
    # Done again, nothing changes: the margins are already what was asked.
    assert not settle_edges(clip, cfg, edges=lambda _p: (162.0, 168.0))
    assert duration_ms(clip.read_bytes()) == after


def test_a_clip_ffmpeg_cannot_read_is_left_alone(tmp_path):
    from frcog.audio import settle_edges
    clip = tmp_path / "frcog-2.mp3"
    _synthetic_clip(clip, 10)
    assert not settle_edges(clip, Config(), edges=lambda _p: None)
    assert not settle_edges(tmp_path / "missing.mp3", Config())



# --- every clip carries its recipe --------------------------------------------

class GoodVoice(FakeVoice):
    """edge-tts on a good day: says everything, and counts what it was asked."""
    refuse = None
    truncate = None
    asked: list[str] = []

    def __init__(self, text: str, voice: str, rate: str = "+0%"):
        super().__init__(text, voice, rate)
        GoodVoice.asked.append(text)


@pytest.fixture()
def voiced(con, monkeypatch):
    """The fixture database after one pass with a good voice under recipe
    "r1": every word has a clip, a row and a recipe."""
    GoodVoice.asked = []
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=GoodVoice))
    monkeypatch.setattr(audio.asyncio, "sleep", _no_sleep)
    first = synthesize_missing(con, quiet(), log=lambda *_: None, recipe="r1")
    assert first.made == 7 and first.have == 7
    assert {r[0] for r in con.execute("SELECT recipe FROM audio WHERE source='tts'")} == {"r1"}
    GoodVoice.asked = []
    return con


def rows_of(con) -> list[tuple]:
    return [tuple(r) for r in con.execute(
        "SELECT id, word_id, recipe, padded FROM audio WHERE source='tts' ORDER BY word_id")]


def test_a_clip_made_by_the_recipe_in_force_is_left_alone_row_and_all(voiced):
    """A run that has nothing to make must change nothing: the rows used to
    be deleted and written again with `padded` reset, and `pad_all` then put
    another margin of silence in front of every clip in the deck and
    re-encoded it, so a run that made nothing changed five thousand files."""
    before = rows_of(voiced)
    again = synthesize_missing(voiced, quiet(), log=lambda *_: None, recipe="r1")
    assert GoodVoice.asked == [], "the voice was not asked"
    assert again.kept == 7 and again.made == 0 and again.adopted == 0
    assert rows_of(voiced) == before, "the same rows, by id, padded as they were"


def test_a_clip_made_by_another_recipe_is_remade_and_stamped_with_this_one(voiced):
    """A new voice, a new margin, a change to audio.py: the recipe differs,
    and every clip it made is made again."""
    lines = []
    redone = synthesize_missing(voiced, quiet(), log=lines.append, recipe="r2")
    assert redone.remade == 7 and redone.made == 7
    assert sorted(GoodVoice.asked) == sorted(r[0] for r in voiced.execute(
        "SELECT COALESCE(spoken_form, type_answer) FROM words"))
    assert {r[2] for r in rows_of(voiced)} == {"r2"}
    assert any("7 clips were made by another recipe" in l for l in lines)


def test_a_clip_from_before_recipes_were_recorded_is_adopted_rather_than_remade(voiced):
    """Every clip in the deck today has no recipe on its row. Remaking them
    all to be sure — five thousand files, twenty minutes of edge-tts, an
    hour of Kokoro for the cues — would prove nothing about a clip that
    already says the right thing, so a usable clip that says what the card
    teaches is stamped with the recipe in force and kept. A recipe recorded
    beside every clip is what makes "is this the clip the recipe says?"
    answerable at all: #61 was a catalogue naming 117 recordings that no
    run on the server had made, and no row that could say so."""
    with voiced:
        voiced.execute("UPDATE audio SET recipe=NULL WHERE source='tts'")
    lines = []
    taken = synthesize_missing(voiced, quiet(), log=lines.append, recipe="r2")
    assert GoodVoice.asked == [], "nothing remade"
    assert taken.adopted == 7 and taken.made == 0
    assert {r[2] for r in rows_of(voiced)} == {"r2"}
    assert any("7 clips adopted" in l for l in lines)
    # Adopted once, it is a clip like any other: the next pass keeps it.
    assert synthesize_missing(voiced, quiet(), log=lambda *_: None, recipe="r2").kept == 7


def test_a_clip_that_no_longer_says_what_the_card_teaches_is_remade_whatever_its_recipe(voiced):
    with voiced:
        voiced.execute("UPDATE words SET type_answer='la Nation' WHERE id=1")
    redone = synthesize_missing(voiced, quiet(), log=lambda *_: None, recipe="r1")
    assert GoodVoice.asked == ["la Nation"]
    assert redone.remade == 1 and redone.kept == 6
    assert voiced.execute("SELECT tts_text FROM words WHERE id=1").fetchone()[0] == "la Nation"


def test_the_judgement_on_a_clip_is_one_rule_for_both_kinds():
    """`judge` is the table the French clips and the English cues share."""
    from frcog.audio import judge
    assert judge(False, "le pont", "le pont", "r1", "r1") == "missing"
    assert judge(True, "le pont", "le point", "r1", "r1") == "text", "text before recipe"
    assert judge(True, "le pont", "le pont", "r0", "r1") == "recipe"
    assert judge(True, "le pont", "le pont", None, "r1") == "adopt", "never stamped"
    assert judge(True, None, "le pont", "r1", "r1") == "adopt", "text never written down"
    assert judge(True, "le pont", "le pont", "r1", "r1") == "kept"
    assert judge(True, "le pont", "le pont", "r0", None) == "kept", "recipes not compared"
    assert judge(True, "le pont", "le pont", None, None) == "kept"


def test_an_older_database_gets_the_recipe_columns_when_it_is_opened(tmp_path):
    """`connect` migrates in place; a database from before recipes were
    recorded opens with the columns NULL, which is what adoption reads."""
    import sqlite3 as sq
    from frcog.db import SCHEMA, connect
    # Yesterday's schema: today's, with the two columns taken back out.
    older = SCHEMA.replace(
        "    trimmed     INTEGER DEFAULT 0,  -- the silence at each end settled (#68)\n"
        "    recipe      TEXT,        -- the stage recipe a synthesised clip was made by (recipe.py)\n"
        "    text        TEXT         -- what an English cue says; a French clip's text is words.tts_text\n",
        "    trimmed     INTEGER DEFAULT 0\n")
    assert "recipe" not in older.split("CREATE TABLE IF NOT EXISTS audio")[1].split(";")[0]
    path = tmp_path / "old.db"
    old = sq.connect(path)
    old.executescript(older)
    old.execute("INSERT INTO words (id, lemma, pos, display_form, type_answer) "
                "VALUES (1, 'pont', 'noun', 'le pont', 'le pont')")
    old.execute("INSERT INTO audio (word_id, path, source) VALUES (1, 'frcog-1.mp3', 'tts')")
    old.commit()
    old.close()
    con = connect(path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(audio)")}
    assert {"recipe", "text"} <= cols
    assert tuple(con.execute("SELECT recipe, text FROM audio").fetchone()) == (None, None)
