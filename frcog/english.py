"""English cues, spoken by Kokoro.

A card says a word's meaning in English and waits for the French. The
browser's own voices were tried first and sounded like a satnav, so the cue is
synthesised here once per word with Kokoro-82M and shipped beside the French
clips; the app then plays a file, which is instant, works offline once cached,
and costs the phone nothing. Kokoro needs torch, so it is an optional extra:

    pip install -e '.[english]'

The cue is the first sense of the primary gloss. The export writes the same
text next to the clip, so what you read and what you hear never disagree.
"""
from __future__ import annotations

import sqlite3
import subprocess
import tempfile
from pathlib import Path

from .audio import Clip, Outcome, REMADE, adopt, judge, media_dir, say_failed, settle_edges, usable
from .config import DEFAULT, Config

SAMPLE_RATE = 24000     # what Kokoro produces
SOURCE = "tts-en"       # in the audio table, beside 'tts' (French) and the human sources


class EnglishUnavailable(RuntimeError):
    """Kokoro is not installed. Everything else still works without it."""


def short_translations(translations: list[str], limit: int = 45, keep: int = 5) -> list[str]:
    """Keep the alternatives to actual translations, not Wiktionary's grammar notes."""
    out = [t for t in translations if len(t) <= limit]
    return (out or translations[:1])[:keep]


def cue_text(en: list[str]) -> str:
    """One sense, not the whole gloss: "to have", never "to have; to own; to possess"."""
    return (en[0] if en else "").split(";")[0].strip()


def english_filename(word_id: int) -> str:
    return f"frcog-{word_id}-en.mp3"


def _pipeline(cfg: Config):
    try:
        import numpy  # noqa: F401  (part of the optional extra, checked here)
        import torch
        from kokoro import KPipeline
    except ImportError as e:
        raise EnglishUnavailable(
            "Kokoro is not installed; run  pip install -e '.[english]'  to add English cues") from e
    device = "cuda" if torch.cuda.is_available() else "cpu"
    # The voice name encodes its accent: af_/am_ American, bf_/bm_ British.
    return KPipeline(lang_code=cfg.english_voice[0], repo_id="hexgrad/Kokoro-82M", device=device)


def _to_mp3(samples, out: Path) -> bool:
    import soundfile as sf
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
        sf.write(tmp.name, samples, SAMPLE_RATE)
        res = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name,
             "-codec:a", "libmp3lame", "-b:a", "48k", "-ac", "1", str(out)],
            capture_output=True)
    return res.returncode == 0 and usable(out)


def cue_for(con: sqlite3.Connection, word_id: int) -> str:
    """What the cue for a word says today: the first sense of its primary
    gloss, after the export's own shortening, so the clip and the card agree."""
    trs = [t["english"] for t in con.execute(
        "SELECT english FROM translations WHERE word_id=? ORDER BY is_primary DESC, sense_index",
        (word_id,))]
    return cue_text(short_translations(trs))


def triage(con: sqlite3.Connection, cfg: Config = DEFAULT, recipe: str | None = None,
           limit: int | None = None) -> list[Clip]:
    """Every active word's cue, judged against its gloss and the recipe, in
    rank order; a word with nothing to say has no cue and is not listed.
    The text a cue was made from is on its audio row, since the words table
    knows only the French."""
    d = media_dir(cfg)
    rows = con.execute(
        "SELECT id FROM words WHERE active=1 ORDER BY rank"
        + (f" LIMIT {int(limit)}" if limit else "")).fetchall()
    out: list[Clip] = []
    for r in rows:
        text = cue_for(con, r["id"])
        if not text:
            continue
        path = d / english_filename(r["id"])
        row = con.execute("SELECT id, recipe, text FROM audio WHERE word_id=? AND source=?",
                          (r["id"], SOURCE)).fetchone()
        kind = judge(usable(path), row["text"] if row else None, text,
                     row["recipe"] if row else None, recipe)
        if kind == "kept" and row is None:
            kind = "adopt"
        out.append(Clip(r["id"], text, path, kind, row["id"] if row else None))
    return out


def _say(pipe, text: str, out: Path, cfg: Config) -> str | None:
    """One cue through Kokoro to an mp3 at `out`. None when it is on disk,
    otherwise why not. numpy arrives with the optional extra, so it is
    imported here and not before a cue is actually wanted."""
    import numpy as np
    chunks = []
    for _, _, audio in pipe(text, voice=cfg.english_voice, speed=cfg.english_speed):
        a = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
        chunks.append(a)
    if not chunks:
        return "Kokoro produced no audio"
    if _to_mp3(np.concatenate(chunks), out):
        settle_edges(out, cfg)
        return None
    # A header with nothing in it must not stay, or the next run would
    # count it as a cue and the card would play silence.
    out.unlink(missing_ok=True)
    return "ffmpeg wrote no usable mp3"


def synthesize_missing(con: sqlite3.Connection, cfg: Config = DEFAULT, limit: int | None = None,
                       log=print, recipe: str | None = None) -> Outcome:
    """Generate the English cue for every active word whose cue is missing
    or stale: the gloss changed under it, or the recipe that made it is not
    the one in force (`audio.judge` has the rule, adoption included).

    A cue used to be remade only when its file was missing, so a gloss
    corrected in a rebuild left the card reading one thing and saying
    another. The text is kept on the cue's row now, as `words.tts_text`
    keeps the French clip's. Raises `EnglishUnavailable` only when there is
    something to synthesise and Kokoro is not installed; a pass with
    nothing to make, or only clips to adopt, needs no Kokoro at all.
    """
    clips = triage(con, cfg, recipe, limit)
    jobs = [c for c in clips if c.kind in ("missing",) + REMADE]
    for kind, what in (("text", "no longer say what their card says"),
                       ("recipe", "were made by another recipe")):
        n = sum(c.kind == kind for c in clips)
        if n:
            log(f"    english: {n} cues {what}")
    adopted = sum(c.kind == "adopt" for c in clips)
    if adopted:
        log(f"    english: {adopted} cues adopted as made by the recipe in force")
    failed: list[tuple[str, str]] = []
    if not jobs:
        log("    english: nothing to do")
    else:
        log(f"    english: {len(jobs)} cues to synthesise with Kokoro voice {cfg.english_voice}")
        pipe = _pipeline(cfg)
        for i, c in enumerate(jobs, 1):
            c.path.unlink(missing_ok=True)
            why = _say(pipe, c.text, c.path, cfg)
            if why:
                failed.append((c.text, why))
            if i % 250 == 0:
                log(f"    english {i}/{len(jobs)}")
        say_failed(log, "english", failed, len(jobs), "made")

    region = "US" if cfg.english_voice.startswith("a") else "GB"
    out = Outcome()
    with con:
        for c in clips:
            if c.kind == "kept":
                out.kept += 1
                continue
            if c.kind == "adopt":
                adopt(con, c, SOURCE, region, recipe, cfg, text=c.text)
                out.adopted += 1
                continue
            con.execute("DELETE FROM audio WHERE word_id=? AND source=?", (c.word_id, SOURCE))
            if not usable(c.path):
                out.failed += 1
                continue
            con.execute(
                "INSERT INTO audio (word_id,path,region,region_rank,source,is_primary,padded,trimmed,"
                "recipe,text) VALUES (?,?,?,0,?,0,1,1,?,?)",
                (c.word_id, c.path.name, region, SOURCE, recipe, c.text))
            out.made += 1
            out.remade += c.kind in REMADE
    out.have = sum(1 for c in clips if usable(c.path))
    return out
