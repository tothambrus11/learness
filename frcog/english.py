"""English cues for walking mode, spoken by Kokoro.

The walk says a word's meaning in English and waits for the French. The
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

from .audio import media_dir, pad_silence
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
    return res.returncode == 0 and out.exists() and out.stat().st_size > 500


def synthesize_missing(con: sqlite3.Connection, cfg: Config = DEFAULT, limit: int | None = None,
                       log=print) -> int:
    """Generate the English cue for every active word that does not have one yet."""
    import numpy as np

    d = media_dir(cfg)
    rows = con.execute(
        "SELECT id FROM words WHERE active=1 ORDER BY rank"
        + (f" LIMIT {int(limit)}" if limit else "")).fetchall()
    jobs = []
    for r in rows:
        out = d / english_filename(r["id"])
        if out.exists() and out.stat().st_size > 500:
            continue
        trs = [t["english"] for t in con.execute(
            "SELECT english FROM translations WHERE word_id=? ORDER BY is_primary DESC, sense_index",
            (r["id"],))]
        text = cue_text(short_translations(trs))
        if text:
            jobs.append((r["id"], text, out))

    fresh: set[Path] = set()
    if not jobs:
        log("    english: nothing to do")
    else:
        log(f"    english: {len(jobs)} cues to synthesise with Kokoro voice {cfg.english_voice}")
        pipe = _pipeline(cfg)
        for i, (_, text, out) in enumerate(jobs, 1):
            chunks = []
            for _, _, audio in pipe(text, voice=cfg.english_voice, speed=cfg.english_speed):
                a = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
                chunks.append(a)
            if chunks and _to_mp3(np.concatenate(chunks), out):
                pad_silence(out, cfg.lead_silence_ms)
                fresh.add(out)
            if i % 250 == 0:
                log(f"    english {i}/{len(jobs)}")

    region = "US" if cfg.english_voice.startswith("a") else "GB"
    with con:
        for r in rows:
            out = d / english_filename(r["id"])
            if not out.exists():
                continue
            con.execute("DELETE FROM audio WHERE word_id=? AND source=?", (r["id"], SOURCE))
            con.execute(
                "INSERT INTO audio (word_id,path,region,region_rank,source,is_primary,padded) "
                "VALUES (?,?,?,?,?,0,1)",
                (r["id"], out.name, region, 0, SOURCE))
    return sum(1 for r in rows if (d / english_filename(r["id"])).exists())
