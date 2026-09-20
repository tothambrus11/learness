from frcog.english import cue_text, english_filename, short_translations


def test_cue_is_one_sense_not_the_whole_gloss():
    assert cue_text(["to have; to own; to possess; to get", "must"]) == "to have"
    assert cue_text(["to be"]) == "to be"
    assert cue_text([]) == ""


def test_cue_uses_the_primary_translation_after_filtering():
    # A long grammar note is dropped, so the cue comes from a real translation.
    trs = ["x" * 60, "the table", "the board"]
    assert cue_text(short_translations(trs)) == "the table"


def test_english_clip_sits_beside_the_french_ones():
    assert english_filename(12) == "frcog-12-en.mp3"



# --- the cue says what the card says, and carries its recipe ------------------

import sqlite3  # noqa: E402

import pytest  # noqa: E402

from catalogue_fixture import seeded  # noqa: E402
from frcog import audio, english  # noqa: E402
from frcog.audio import MIN_BYTES  # noqa: E402
from frcog.config import Config  # noqa: E402


#: What the stand-in for Kokoro was asked to say, in order, this test.
SAID: list[str] = []


@pytest.fixture()
def con(tmp_path, monkeypatch) -> sqlite3.Connection:
    """The fixture database, its media directory temporary, and Kokoro stood
    in for: a pipeline that loads, and a synthesis that writes a clip's worth
    of nothing and records what it was asked to say in `SAID`."""
    monkeypatch.setattr(audio, "MEDIA", tmp_path / "media")
    SAID.clear()

    def fake_say(pipe, text, out, cfg):
        SAID.append(text)
        out.write_bytes(b"\0" * (MIN_BYTES + 1))
        return None

    monkeypatch.setattr(english, "_pipeline", lambda cfg: object())
    monkeypatch.setattr(english, "_say", fake_say)
    return seeded(tmp_path / "test.db")


def quiet() -> Config:
    cfg = Config()
    cfg.lead_silence_ms = 0
    return cfg


def cues(con) -> dict[int, tuple]:
    return {r[0]: tuple(r)[1:] for r in con.execute(
        "SELECT word_id, text, recipe FROM audio WHERE source='tts-en' ORDER BY word_id")}


def test_a_cue_is_made_for_every_active_word_and_records_what_it_says(con):
    first = english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
    assert first.made == 6 and first.have == 6, "six active words; the dropped one has no cue"
    assert sorted(SAID) == ["bridge", "day", "nation", "oblivion", "to speak", "train"]
    assert cues(con)[2] == ("to speak", "e1"), "the text on the row, beside the recipe"


def test_a_cue_whose_gloss_changed_is_remade(con):
    """A cue used to be remade only when its file was missing, so a gloss
    corrected in a rebuild left the card reading "country" and the voice
    saying "nation". The text is kept on the row now, as the French clip's
    is kept on the word, and compared on every pass."""
    english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
    SAID.clear()
    with con:
        con.execute("UPDATE translations SET english='country' WHERE word_id=1 AND is_primary=1")
    lines = []
    redone = english.synthesize_missing(con, quiet(), log=lines.append, recipe="e1")
    assert SAID == ["country"], "only the one whose gloss moved"
    assert redone.remade == 1 and redone.kept == 5
    assert cues(con)[1] == ("country", "e1")
    assert any("1 cues no longer say what their card says" in l for l in lines)


def test_a_cue_from_before_recipes_were_recorded_is_adopted_with_its_text_and_recipe(con):
    """Every cue in the deck today has neither on its row. Adoption stamps
    both from what the card says now — the one-time assumption that the
    clip on disk says what its card does; a gloss that changed before the
    stamping is not caught — and needs no Kokoro at all."""
    english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
    SAID.clear()
    with con:
        con.execute("UPDATE audio SET recipe=NULL, text=NULL WHERE source='tts-en'")
    taken = english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e2")
    assert SAID == [] and taken.adopted == 6
    assert cues(con)[1] == ("nation", "e2")


def test_a_cue_made_by_another_recipe_is_remade(con):
    english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
    SAID.clear()
    redone = english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e2")
    assert redone.remade == 6 and len(SAID) == 6
    assert {v[1] for v in cues(con).values()} == {"e2"}


def test_a_pass_with_nothing_to_make_does_not_need_kokoro(con, monkeypatch):
    """Kokoro is an optional extra. A machine without it must still be able
    to adopt and keep the cues it has, and only fail when asked to say something."""
    english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")

    def unavailable(cfg):
        raise english.EnglishUnavailable("Kokoro is not installed")

    monkeypatch.setattr(english, "_pipeline", unavailable)
    kept = english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
    assert kept.kept == 6
    with con:
        con.execute("UPDATE translations SET english='country' WHERE word_id=1 AND is_primary=1")
    with pytest.raises(english.EnglishUnavailable):
        english.synthesize_missing(con, quiet(), log=lambda *_: None, recipe="e1")
