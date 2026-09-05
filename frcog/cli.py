"""Command line for the pipeline.

    frcog fetch      download the Wiktionary extract
    frcog build      frequency + dictionary + similarity -> SQLite
    frcog audio      Swiss TTS prompts, plus native recordings
    frcog stats      how much French you can read now
    frcog app        export the catalogue for the web app and serve it
    frcog import-app merge progress exported from the app
    frcog top        print the head of the ranking
"""
from __future__ import annotations

import argparse
import functools
import http.server
import os
import socketserver
import sys
from pathlib import Path

from . import audio as audio_mod
from . import build, stats, webexport
from .config import APP_DIR, DEFAULT, KAIKKI_PATH, KAIKKI_URL, MEDIA, Config
from .db import connect


def _cfg(args) -> Config:
    cfg = Config()
    for name in ("top_n", "max_words", "level_size", "tts_voice"):
        val = getattr(args, name, None)
        if val is not None:
            setattr(cfg, name, val)
    return cfg


def cmd_fetch(args) -> int:
    import requests
    KAIKKI_PATH.parent.mkdir(parents=True, exist_ok=True)
    if KAIKKI_PATH.exists() and not args.force:
        print(f"already have {KAIKKI_PATH} ({KAIKKI_PATH.stat().st_size / 1e6:.0f} MB); "
              f"use --force to re-download")
        return 0
    print(f"downloading {KAIKKI_URL}")
    with requests.get(KAIKKI_URL, stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(KAIKKI_PATH, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done / 1e6:.0f}/{total / 1e6:.0f} MB", end="", flush=True)
    print(f"\n  saved {KAIKKI_PATH}")
    return 0


def cmd_build(args) -> int:
    if not KAIKKI_PATH.exists():
        print(f"missing {KAIKKI_PATH}; run `frcog fetch` first", file=sys.stderr)
        return 1
    build.run(_cfg(args))
    return 0


def cmd_audio(args) -> int:
    cfg = _cfg(args)
    if args.lead_silence is not None:
        cfg.lead_silence_ms = args.lead_silence
    con = connect()
    print("Audio")
    if args.repad:
        n = audio_mod.pad_all(con, cfg, force=args.force_repad)
        print(f"  padded {n} files")
        con.close()
        return 0
    if not args.native_only:
        audio_mod.synthesize_missing(con, cfg, limit=args.limit)
    if not args.tts_only:
        audio_mod.fetch_human(con, cfg, limit=args.limit)
    audio_mod.pad_all(con, cfg)
    print("  " + ", ".join(f"{k}={v}" for k, v in audio_mod.stats(con).items()))
    con.close()
    return 0


def cmd_stats(args) -> int:
    con = connect()
    print(stats.format_summary(stats.summary(con)))
    con.close()
    return 0


def cmd_top(args) -> int:
    con = connect()
    rows = con.execute(
        """SELECT w.rank, w.display_form, w.pos, w.similarity, w.zipf, w.level, w.is_core,
                  (SELECT english FROM translations t WHERE t.word_id=w.id AND t.is_primary=1) en
           FROM words w WHERE w.active=1 AND w.rank > ? ORDER BY w.rank LIMIT ?""",
        (args.offset, args.n)).fetchall()
    print(f"{'rank':>5}  {'':4} {'French':<24} {'English':<24} {'pos':<5} {'sim':>4} {'zipf':>5} lvl")
    for r in rows:
        print(f"{r['rank']:>5}  {'core' if r['is_core'] else '    '} {r['display_form']:<24} "
              f"{(r['en'] or '')[:24]:<24} {r['pos']:<5} {r['similarity']:>4.2f} "
              f"{r['zipf']:>5.2f} {r['level']:>3}")
    con.close()
    return 0


class _AppHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the app directory, with the audio files mounted at /media/."""

    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/media/"):
            return str(MEDIA / os.path.basename(clean))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *a):
        pass


def cmd_app(args) -> int:
    cfg = _cfg(args)
    con = connect()
    print("Web app export")
    webexport.export(con, cfg=cfg, max_level=args.max_level)
    con.close()
    if args.no_serve:
        return 0
    handler = functools.partial(_AppHandler, directory=str(APP_DIR))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", args.port), handler) as httpd:
        print(f"\n  Walking mode:  http://localhost:{args.port}/")
        print("  Speech recognition needs Chrome, Edge or Android Chrome.")
        print("  Ctrl-C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped")
    return 0


def cmd_import_app(args) -> int:
    con = connect()
    webexport.import_reviews(con, Path(args.file))
    print(stats.format_summary(stats.summary(con)))
    con.close()
    return 0


def cmd_all(args) -> int:
    """One command from nothing to a deck you can study."""
    if not KAIKKI_PATH.exists():
        cmd_fetch(argparse.Namespace(force=False))
    cfg = _cfg(args)
    build.run(cfg)
    con = connect()
    print("Audio")
    audio_mod.synthesize_missing(con, cfg, limit=args.limit)
    if not args.tts_only:
        audio_mod.fetch_human(con, cfg, limit=args.limit)
    audio_mod.pad_all(con, cfg)
    out = webexport.export(con, cfg=cfg)
    con.close()
    print(f"\nCatalogue ready at {out}. Run `frcog app` to study.")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="frcog", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--top-n", type=int, help="how many frequent French words to consider")
    p.add_argument("--max-words", type=int, help="how many words to keep after ranking")
    p.add_argument("--level-size", type=int, help="words per level / Anki subdeck")
    p.add_argument("--tts-voice", help="edge-tts voice (default fr-CH-ArianeNeural)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("fetch", help="download the Wiktionary extract")
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_fetch)

    s = sub.add_parser("build", help="build the ranking into SQLite")
    s.set_defaults(func=cmd_build)

    s = sub.add_parser("audio", help="generate TTS and fetch native recordings")
    s.add_argument("--limit", type=int)
    s.add_argument("--tts-only", action="store_true")
    s.add_argument("--native-only", action="store_true")
    s.add_argument("--repad", action="store_true",
                   help="only add leading silence to existing files")
    s.add_argument("--force-repad", action="store_true",
                   help="pad again even if already padded")
    s.add_argument("--lead-silence", type=int, metavar="MS",
                   help="milliseconds of leading silence (default 300)")
    s.set_defaults(func=cmd_audio)

    s = sub.add_parser("stats", help="show progress")
    s.set_defaults(func=cmd_stats)

    s = sub.add_parser("top", help="print the head of the ranking")
    s.add_argument("-n", type=int, default=40)
    s.add_argument("--offset", type=int, default=0)
    s.set_defaults(func=cmd_top)

    s = sub.add_parser("app", help="export JSON and serve the walking-mode app")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--max-level", type=int)
    s.add_argument("--no-serve", action="store_true")
    s.set_defaults(func=cmd_app)

    s = sub.add_parser("import-app", help="merge reviews exported from the web app")
    s.add_argument("file")
    s.set_defaults(func=cmd_import_app)

    s = sub.add_parser("all", help="fetch, build, audio, export in one go")
    s.add_argument("--limit", type=int)
    s.add_argument("--tts-only", action="store_true")
    s.set_defaults(func=cmd_all)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
