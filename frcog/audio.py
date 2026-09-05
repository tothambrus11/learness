"""Audio for the cards.

Two kinds, and they do different jobs:

* TTS (Swiss French voice) of the exact phrase the learner has to type,
  including the article. Uniform, always available, and it matches the typed
  answer, so the listening prompt and the expected answer never disagree.
* A native human recording of the bare headword, attached to the back of the
  card as a pronunciation reference. Region preference is Switzerland first,
  then France; Quebec recordings are never used.
"""
from __future__ import annotations

import asyncio
import sqlite3
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import edge_tts
import requests

from .config import DEFAULT, Config, MEDIA

UA = "frcog/0.1 (personal French vocabulary study deck; low-rate, resumable)"


def pad_silence(path: Path, ms: int) -> bool:
    """Prepend `ms` of silence to an mp3, preserving its format.

    Both edge-tts and Lingua Libre hand back files whose first sample is already
    speech. Players routinely swallow the first few tens of milliseconds while
    the decoder spins up, which clips the start of the word — worst for exactly
    the short words this deck is full of. A little padding removes the problem
    everywhere at once, including inside Anki, where playback is not ours to fix.
    """
    if ms <= 0 or not path.exists():
        return False
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=sample_rate,channels,bit_rate", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True)
    vals = [v.strip() for v in probe.stdout.splitlines() if v.strip()]
    rate = vals[0] if len(vals) > 0 and vals[0].isdigit() else "24000"
    chans = vals[1] if len(vals) > 1 and vals[1].isdigit() else "1"
    bitrate = vals[2] if len(vals) > 2 and vals[2].isdigit() else "48000"
    tmp = path.with_suffix(".pad.mp3")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(path),
           "-af", f"adelay={ms}:all=1", "-c:a", "libmp3lame",
           "-ar", rate, "-ac", chans, "-b:a", bitrate, str(tmp)]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        tmp.unlink(missing_ok=True)
        return False
    if tmp.exists() and tmp.stat().st_size > 500:
        tmp.replace(path)
        return True
    tmp.unlink(missing_ok=True)
    return False


def pad_all(con: sqlite3.Connection, cfg: Config = DEFAULT, force: bool = False,
            log=print) -> int:
    """Add leading silence to every audio file that has not had it yet."""
    d = media_dir(cfg)
    where = "" if force else " AND COALESCE(padded,0) = 0"
    rows = con.execute(
        f"SELECT id, path FROM audio WHERE path IS NOT NULL{where}").fetchall()
    todo = [(r["id"], d / r["path"]) for r in rows if (d / r["path"]).exists()]
    if not todo:
        log("    padding: nothing to do")
        return 0
    log(f"    padding {len(todo)} files with {cfg.lead_silence_ms}ms of leading silence")
    done = 0
    with ThreadPoolExecutor(max_workers=max(2, cfg.audio_concurrency)) as pool:
        futures = {pool.submit(pad_silence, path, cfg.lead_silence_ms): rid
                   for rid, path in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            if fut.result():
                with con:
                    con.execute("UPDATE audio SET padded=1 WHERE id=?", (futures[fut],))
                done += 1
            if i % 500 == 0:
                log(f"    padded {i}/{len(todo)}")
    return done


def media_dir(cfg: Config = DEFAULT) -> Path:
    MEDIA.mkdir(parents=True, exist_ok=True)
    return MEDIA


def tts_filename(word_id: int) -> str:
    return f"frcog-{word_id}.mp3"


def human_filename(word_id: int) -> str:
    return f"frcog-{word_id}-native.mp3"


async def _synth_one(text: str, out: Path, cfg: Config, sem: asyncio.Semaphore) -> bool:
    async with sem:
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(text, cfg.tts_voice, rate=cfg.tts_rate)
                await comm.save(str(out))
                if out.exists() and out.stat().st_size > 500:
                    return True
            except Exception:
                await asyncio.sleep(1.5 * (attempt + 1))
        return False


async def _synth_all(jobs: list[tuple[str, Path]], cfg: Config, log) -> int:
    sem = asyncio.Semaphore(cfg.audio_concurrency)
    done = 0
    tasks = [asyncio.create_task(_synth_one(t, p, cfg, sem)) for t, p in jobs]
    for i, fut in enumerate(asyncio.as_completed(tasks), 1):
        if await fut:
            done += 1
        if i % 250 == 0:
            log(f"    tts {i}/{len(jobs)}")
    return done


def synthesize_missing(con: sqlite3.Connection, cfg: Config = DEFAULT, limit: int | None = None,
                       log=print) -> int:
    """Generate the TTS prompt for every word that does not have one yet."""
    d = media_dir(cfg)
    rows = con.execute(
        "SELECT id, type_answer FROM words ORDER BY rank" + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()
    jobs = []
    for r in rows:
        out = d / tts_filename(r["id"])
        if out.exists() and out.stat().st_size > 500:
            continue
        jobs.append((r["type_answer"], out))
    if not jobs:
        log("    tts: nothing to do")
    else:
        log(f"    tts: {len(jobs)} files to generate with {cfg.tts_voice}")
        asyncio.run(_synth_all(jobs, cfg, log))

    fresh = {p for _, p in jobs}
    for _, path in jobs:
        if path.exists():
            pad_silence(path, cfg.lead_silence_ms)
    with con:
        for r in rows:
            out = d / tts_filename(r["id"])
            if not out.exists():
                continue
            con.execute("DELETE FROM audio WHERE word_id=? AND source='tts'", (r["id"],))
            con.execute(
                "INSERT INTO audio (word_id,path,region,region_rank,source,is_primary,padded) "
                "VALUES (?,?,?,?,'tts',1,?)",
                (r["id"], out.name, "CH", 0, 1 if out in fresh else 0))
    return sum(1 for r in rows if (d / tts_filename(r["id"])).exists())


class _RateLimiter:
    """Wikimedia answers a burst with HTTP 429 and stays unhappy for a while, so
    every thread passes through one shared minimum-interval gate."""

    def __init__(self, per_second: float):
        self.interval = 1.0 / max(per_second, 0.1)
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            slot = max(now, self.next_at)
            self.next_at = slot + self.interval
        delay = slot - now
        if delay > 0:
            time.sleep(delay)


_limiter: _RateLimiter | None = None


def _download(args) -> tuple[int, str | None]:
    """Worker: fetch one recording. Returns (audio_row_id, saved filename or None)."""
    row_id, word_id, url, dest = args
    sess = _thread_session()
    for attempt in range(6):
        if _limiter:
            _limiter.wait()
        try:
            resp = sess.get(url, timeout=30)
        except requests.RequestException:
            time.sleep(1 + attempt)
            continue
        if resp.status_code == 200 and len(resp.content) > 500:
            dest.write_bytes(resp.content)
            return row_id, dest.name
        if resp.status_code in (429, 503):
            wait = float(resp.headers.get("Retry-After") or 0) or (2 ** attempt)
            time.sleep(min(wait, 10) + attempt)
            continue
        break        # 404 and friends are not worth retrying
    return row_id, None


_local = threading.local()


def _thread_session() -> requests.Session:
    if not hasattr(_local, "sess"):
        s = requests.Session()
        s.headers["User-Agent"] = UA
        _local.sess = s
    return _local.sess


def fetch_human(con: sqlite3.Connection, cfg: Config = DEFAULT, limit: int | None = None,
                log=print) -> int:
    """Download the best-region native recording for each word that has one.

    Wikimedia is fine with a handful of parallel requests and there are a few
    thousand files, so this runs on a small thread pool. Database writes stay on
    the calling thread.
    """
    d = media_dir(cfg)
    rows = con.execute(
        """SELECT a.id, a.word_id, a.url, a.region, MIN(a.region_rank) AS best
           FROM audio a JOIN words w ON w.id = a.word_id
           WHERE a.source != 'tts' AND a.region_rank < 99 AND w.active = 1
           GROUP BY a.word_id
           ORDER BY MIN(w.rank)""" + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()

    jobs, already = [], 0
    for r in rows:
        out = d / human_filename(r["word_id"])
        if out.exists() and out.stat().st_size > 500:
            already += 1
            with con:
                con.execute("UPDATE audio SET path=? WHERE id=?", (out.name, r["id"]))
            continue
        jobs.append((r["id"], r["word_id"], r["url"], out))

    log(f"    native: {len(jobs)} to fetch, {already} already on disk")
    global _limiter
    _limiter = _RateLimiter(cfg.native_rate_limit)
    ok = already
    if jobs:
        with ThreadPoolExecutor(max_workers=cfg.native_concurrency) as pool:
            for i, (row_id, name) in enumerate(pool.map(_download, jobs), 1):
                if name:
                    padded = pad_silence(d / name, cfg.lead_silence_ms)
                    with con:
                        con.execute("UPDATE audio SET path=?, padded=? WHERE id=?",
                                    (name, int(padded), row_id))
                    ok += 1
                if i % 500 == 0:
                    log(f"    native {i}/{len(jobs)} ({ok} ok)")
    return ok


def stats(con: sqlite3.Connection) -> dict:
    q = lambda s: con.execute(s).fetchone()[0]
    active = "JOIN words w ON w.id = a.word_id WHERE w.active = 1"
    return {
        "words": q("SELECT COUNT(*) FROM words WHERE active=1"),
        "tts": q(f"SELECT COUNT(*) FROM audio a {active} AND a.source='tts' AND a.path IS NOT NULL"),
        "native": q(f"SELECT COUNT(DISTINCT a.word_id) FROM audio a {active} "
                    "AND a.source!='tts' AND a.path IS NOT NULL"),
        "native_swiss": q(f"SELECT COUNT(DISTINCT a.word_id) FROM audio a {active} "
                          "AND a.source!='tts' AND a.path IS NOT NULL AND a.region='Switzerland'"),
    }
