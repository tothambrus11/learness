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
    assert made == 5


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
