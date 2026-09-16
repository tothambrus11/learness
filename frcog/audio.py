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

from . import mp3
from .config import DEFAULT, Config, MEDIA

UA = "frcog/0.1 (personal French vocabulary study deck; low-rate, resumable)"


def pad_silence(path: Path, ms: int) -> bool:
    """Prepend `ms` of silence to an mp3, preserving its format.

    Both edge-tts and Lingua Libre hand back files whose first sample is already
    speech. Players routinely swallow the first few tens of milliseconds while
    the decoder spins up, which clips the start of the word — worst for exactly
    the short words this deck is full of. A little padding removes the problem
    everywhere at once, including inside Anki, where playback is not ours to fix.

    This re-encodes, so it is the fallback: `settle_edges` cuts frames off a
    clip with too much silence, losslessly, and pads only one with too little.
    """
    if ms <= 0 or not path.exists():
        return False
    # ffmpeg's own account of the stream — "Audio: mp3, 24000 Hz, mono, fltp,
    # 48 kb/s" — rather than ffprobe's: one program to have on the machine.
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)],
                           capture_output=True, text=True)
    line = next((ln for ln in probe.stderr.splitlines() if "Audio:" in ln), "")
    fields = [f.strip() for f in line.split("Audio:")[-1].split(",")]
    rate = next((f.split()[0] for f in fields if f.endswith(" Hz")), "24000")
    chans = "2" if any(f == "stereo" for f in fields) else "1"
    bitrate = next((f.split()[0] + "000" for f in fields if f.endswith(" kb/s")), "48000")
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


#: Quieter than this is silence, for finding where the voice starts. -40 dB is
#: well under the room tone edge-tts and a phone leave in a clip and well over
#: the noise floor of an mp3 at 48 kb/s.
SILENCE_DB = -40
#: A silence shorter than this is a gap in speech, not an edge.
SILENCE_MIN_S = 0.05


def silence_edges(path: Path) -> tuple[float, float] | None:
    """How much silence a clip starts and ends with, in milliseconds, as
    ffmpeg hears it. None when ffmpeg is not there or could not read the
    file. A clip that is silent throughout reports its whole length as lead
    and nothing as tail, so it is cut to its margin and no further."""
    try:
        run = subprocess.run(
            ["ffmpeg", "-v", "info", "-i", str(path),
             "-af", f"silencedetect=n={SILENCE_DB}dB:d={SILENCE_MIN_S}", "-f", "null", "-"],
            capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if run.returncode != 0:
        return None
    starts: list[float] = []
    ends: list[float] = []
    total = 0.0
    for line in run.stderr.splitlines():
        if "silence_start:" in line:
            starts.append(float(line.split("silence_start:")[1].split("|")[0]) * 1000)
        elif "silence_end:" in line:
            ends.append(float(line.split("silence_end:")[1].split("|")[0]) * 1000)
        elif "time=" in line:
            # The progress line's `time=` is how much sound was decoded — the
            # clip's length on the decoder's own clock, which the frame count
            # is not: the encoder's delay and padding are frames it skips.
            stamp = line.split("time=")[1].split()[0]
            h, m, sec = stamp.split(":")
            total = (int(h) * 3600 + int(m) * 60 + float(sec)) * 1000
    if not total:
        total = mp3.duration_ms(path.read_bytes())
    lead = 0.0
    if starts and starts[0] <= 1:
        lead = ends[0] if ends else total
    tail = 0.0
    # The last silence runs to the end when it has no end, or ends where the
    # sound does (the progress time is rounded to 10 ms; allow a little more).
    if starts and (len(ends) < len(starts) or ends[-1] >= total - 40):
        tail = max(0.0, total - starts[-1])
        if lead and starts[-1] <= 1:
            tail = 0.0                         # one silence, the whole clip: lead has it
    return lead, tail


def settle_edges(path: Path, cfg: Config = DEFAULT, edges=silence_edges) -> bool:
    """Bring the silence at each end of a clip to what the config says: cut
    frames off, without decoding, where the voice left more; pad where it
    left less. True when the file changed. The cut is never past the margin
    — a frame is a few tens of milliseconds, and a whole one is kept rather
    than half of it — so the onset is never clipped."""
    if not path.exists():
        return False
    found = edges(path)
    if found is None:
        return False
    lead, tail = found
    changed = False
    if lead < cfg.lead_silence_ms - 30:
        changed = pad_silence(path, int(cfg.lead_silence_ms - lead))
        lead = cfg.lead_silence_ms
    drop_lead = max(0.0, lead - cfg.lead_silence_ms)
    drop_tail = max(0.0, tail - cfg.tail_silence_ms)
    if drop_lead < 20 and drop_tail < 20:
        return changed
    data = path.read_bytes()
    out = mp3.cut(data, drop_lead, drop_tail)
    if out is None or len(out) < MIN_BYTES:
        return changed
    tmp = path.with_suffix(".cut.mp3")
    tmp.write_bytes(out)
    tmp.replace(path)
    return True


def trim_all(con: sqlite3.Connection, cfg: Config = DEFAULT, force: bool = False,
             log=print) -> int:
    """Settle the edges of every clip on disk that has not had it done, and
    mark it; `force` does them all again. Idempotent: a clip already at its
    margins is left alone and still marked."""
    d = media_dir(cfg)
    where = "" if force else " AND COALESCE(trimmed,0) = 0"
    rows = con.execute(
        f"SELECT id, path FROM audio WHERE path IS NOT NULL{where}").fetchall()
    todo = [(r["id"], d / r["path"]) for r in rows if (d / r["path"]).exists()]
    if not todo:
        log("    trimming: nothing to do")
        return 0
    log(f"    trimming {len(todo)} files to {cfg.lead_silence_ms}ms before and "
        f"{cfg.tail_silence_ms}ms after the voice")
    done = 0
    with ThreadPoolExecutor(max_workers=max(2, cfg.audio_concurrency)) as pool:
        futures = {pool.submit(settle_edges, path, cfg): rid for rid, path in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            if fut.result():
                done += 1
            with con:
                con.execute("UPDATE audio SET trimmed=1 WHERE id=?", (futures[fut],))
            if i % 500 == 0:
                log(f"    trimmed {i}/{len(todo)}")
    return done


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


#: Under this, a file is not a clip: an mp3 header and nothing to hear, which
#: is what a cut-off download or an interrupted synthesis leaves behind.
MIN_BYTES = 500


def usable(path: Path) -> bool:
    """Whether a recording is there and is a recording.

    The one test every step applies before it counts a clip as made, and the
    one the export applies before it promises the clip to the app. The
    catalogue used to trust the database instead, and named 250 files that
    were on the maintainer's disk and never committed (#61): every card for
    those words told the learner its recording could not be fetched.
    """
    return path.exists() and path.stat().st_size > MIN_BYTES


async def _synth_one(text: str, out: Path, cfg: Config, sem: asyncio.Semaphore) -> str | None:
    """Synthesise one clip. None when it is on disk; otherwise why it is not.

    The reason used to be swallowed: three tries, a False, and the run's
    summary counted what it had rather than what it had not. A word that
    edge-tts refuses then shipped without a voice, and nobody knew which.
    """
    async with sem:
        why = "no clip written"
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(text, cfg.tts_voice, rate=cfg.tts_rate)
                await comm.save(str(out))
                if usable(out):
                    return None
            except Exception as e:  # noqa: BLE001 - the reason is what is wanted
                why = f"{type(e).__name__}: {e}"
                await asyncio.sleep(1.5 * (attempt + 1))
        # A header with nothing in it is worse than nothing: the audio step
        # would take it for a clip and the card would play silence.
        out.unlink(missing_ok=True)
        return why


async def _synth_all(jobs: list[tuple[str, Path]], cfg: Config, log) -> list[tuple[str, str]]:
    """Every clip, a few at a time. Returns what failed: (text, why)."""
    sem = asyncio.Semaphore(cfg.audio_concurrency)
    failed: list[tuple[str, str]] = []

    async def one(text: str, out: Path) -> None:
        why = await _synth_one(text, out, cfg, sem)
        if why is not None:
            failed.append((text, why))

    tasks = [asyncio.create_task(one(t, p)) for t, p in jobs]
    for i, fut in enumerate(asyncio.as_completed(tasks), 1):
        await fut
        if i % 250 == 0:
            log(f"    tts {i}/{len(jobs)}")
    return failed


def say_failed(log, what: str, failed: list[tuple[str, str]], of: int, verb: str,
               show: int = 20) -> None:
    """Name what a step could not make, and count it, so the run's summary
    shows the failures and not only the successes. `refresh.sh` prints this
    log; a word without a clip is then a known thing, not a surprise on a card."""
    if not failed:
        return
    for text, why in failed[:show]:
        log(f"    {what}: {text!r} could not be {verb}: {why}")
    if len(failed) > show:
        log(f"    {what}: … and {len(failed) - show} more")
    log(f"    {what}: {len(failed)} of {of} could not be {verb}; "
        "those words ship without one until the next run")


def synthesize_missing(con: sqlite3.Connection, cfg: Config = DEFAULT, limit: int | None = None,
                       log=print) -> int:
    """Generate the TTS prompt for every word whose clip is missing or stale.

    Stale matters as much as missing: a rebuild that changes what a card teaches
    ("une erreur" becoming "l'erreur") leaves a clip saying the old thing, and a
    listening card would then be marked wrong for hearing correctly. The text
    each clip was made from is recorded beside it, so the mismatch is visible.
    """
    d = media_dir(cfg)
    # The clip says the spoken form: one real utterance, which for "le/la
    # ministre" is "le ministre". Older databases have no spoken form yet and
    # fall back to the typed answer, which is the same string for every word
    # but those.
    rows = con.execute(
        "SELECT id, COALESCE(spoken_form, type_answer) AS text, tts_text FROM words "
        "ORDER BY rank" + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()
    jobs = []
    stale = 0
    for r in rows:
        out = d / tts_filename(r["id"])
        if usable(out):
            if r["tts_text"] == r["text"]:
                continue
            if r["tts_text"] is not None:
                stale += 1
            # Remove it before regenerating, so a failed synthesis leaves the
            # word with no clip rather than with the wrong one.
            out.unlink()
        jobs.append((r["text"], out))
    if stale:
        log(f"    tts: {stale} clips no longer say what their card teaches")
    if not jobs:
        log("    tts: nothing to do")
    else:
        log(f"    tts: {len(jobs)} files to generate with {cfg.tts_voice}")
        failed = asyncio.run(_synth_all(jobs, cfg, log))
        say_failed(log, "tts", failed, len(jobs), "made")

    fresh = {p for _, p in jobs}
    for _, path in jobs:
        if path.exists():
            settle_edges(path, cfg)
    with con:
        for r in rows:
            out = d / tts_filename(r["id"])
            con.execute("DELETE FROM audio WHERE word_id=? AND source='tts'", (r["id"],))
            if not usable(out):
                # Nothing on disk: a stale clip that failed to regenerate
                # must not keep its row, or the export ships a dead path.
                continue
            con.execute(
                "INSERT INTO audio (word_id,path,region,region_rank,source,is_primary,padded) "
                "VALUES (?,?,?,?,'tts',1,?)",
                (r["id"], out.name, "CH", 0, 1 if out in fresh else 0))
            con.execute("UPDATE words SET tts_text=? WHERE id=?",
                        (r["text"], r["id"]))
    return sum(1 for r in rows if usable(d / tts_filename(r["id"])))


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


def _download(args) -> tuple[int, str | None, str]:
    """Worker: fetch one recording.

    Returns (audio_row_id, saved filename or None, why not) — the reason is
    empty when the file was saved, and otherwise says what Wikimedia said,
    because a recording that is gone from Commons and one that was rate
    limited are different problems and used to look the same."""
    row_id, word_id, url, dest = args
    sess = _thread_session()
    why = "gave up"
    for attempt in range(6):
        if _limiter:
            _limiter.wait()
        try:
            resp = sess.get(url, timeout=30)
        except requests.RequestException as e:
            why = f"{type(e).__name__}: {e}"
            time.sleep(1 + attempt)
            continue
        if resp.status_code == 200 and len(resp.content) > MIN_BYTES:
            dest.write_bytes(resp.content)
            return row_id, dest.name, ""
        why = f"HTTP {resp.status_code}" + ("" if resp.status_code != 200 else
                                             f", {len(resp.content)} bytes")
        if resp.status_code in (429, 503):
            wait = float(resp.headers.get("Retry-After") or 0) or (2 ** attempt)
            time.sleep(min(wait, 10) + attempt)
            continue
        break        # 404 and friends are not worth retrying
    return row_id, None, why


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
           WHERE a.source NOT IN ('tts', 'tts-en') AND a.url IS NOT NULL
             AND a.region_rank < 99 AND w.active = 1
           GROUP BY a.word_id
           ORDER BY MIN(w.rank)""" + (f" LIMIT {int(limit)}" if limit else "")
    ).fetchall()

    jobs, already = [], 0
    for r in rows:
        out = d / human_filename(r["word_id"])
        if usable(out):
            already += 1
            with con:
                con.execute("UPDATE audio SET path=? WHERE id=?", (out.name, r["id"]))
            continue
        jobs.append((r["id"], r["word_id"], r["url"], out))

    log(f"    native: {len(jobs)} to fetch, {already} already on disk")
    global _limiter
    _limiter = _RateLimiter(cfg.native_rate_limit)
    ok = already
    failed: list[tuple[str, str]] = []
    if jobs:
        with ThreadPoolExecutor(max_workers=cfg.native_concurrency) as pool:
            for i, ((row_id, name, why), job) in enumerate(zip(pool.map(_download, jobs), jobs), 1):
                if name:
                    settled = settle_edges(d / name, cfg)
                    with con:
                        con.execute("UPDATE audio SET path=?, padded=?, trimmed=1 WHERE id=?",
                                    (name, int(settled), row_id))
                    ok += 1
                else:
                    failed.append((job[2], why))
                if i % 500 == 0:
                    log(f"    native {i}/{len(jobs)} ({ok} ok)")
        say_failed(log, "native", failed, len(jobs), "fetched")
    return ok


def stats(con: sqlite3.Connection) -> dict:
    q = lambda s: con.execute(s).fetchone()[0]
    active = "JOIN words w ON w.id = a.word_id WHERE w.active = 1"
    return {
        "words": q("SELECT COUNT(*) FROM words WHERE active=1"),
        "tts": q(f"SELECT COUNT(*) FROM audio a {active} AND a.source='tts' AND a.path IS NOT NULL"),
        "native": q(f"SELECT COUNT(DISTINCT a.word_id) FROM audio a {active} "
                    "AND a.source NOT IN ('tts','tts-en') AND a.path IS NOT NULL"),
        "english": q(f"SELECT COUNT(*) FROM audio a {active} AND a.source='tts-en' AND a.path IS NOT NULL"),
        "native_swiss": q(f"SELECT COUNT(DISTINCT a.word_id) FROM audio a {active} "
                          "AND a.source NOT IN ('tts','tts-en') AND a.path IS NOT NULL AND a.region='Switzerland'"),
    }
