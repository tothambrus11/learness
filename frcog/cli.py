"""Command line for the pipeline.

    frcog fetch      download the dumps the recipe pins, and pin them
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
from . import english
from . import build, stats, webexport
from .config import APP_DIR, DEFAULT, KAIKKI_PATH, MEDIA, Config
from .db import connect


def _cfg(args) -> Config:
    cfg = Config()
    for name in ("top_n", "max_words", "level_size", "tts_voice", "english_voice"):
        val = getattr(args, name, None)
        if val is not None:
            setattr(cfg, name, val)
    return cfg


def cmd_fetch(args) -> int:
    """Every dump on disk and pinned: what `frcog refresh` does first, on its
    own, for a checkout that only wants the upstream files."""
    from . import recipe as recipe_mod
    from . import sources
    rec = recipe_mod.Recipe.load()
    try:
        done = sources.ensure(rec.sources, accept=args.accept_sources)
    finally:
        rec.save()          # the pins settled before a refusal are worth keeping
    for name, what in done.items():
        print(f"  {what:<8} {sources.describe(name, rec.sources)}")
    return 0


def cmd_definitions(args) -> int:
    from . import definitions
    con = connect()
    print("Definitions")
    n = definitions.attach(con, log=print)
    con.close()
    return 0 if n else 1


def cmd_dictionary(args) -> int:
    """Every word the extract glosses, for the words screen to fill a form from.

    Separate from `build` because it is a different question — build asks what
    is worth teaching, this asks what French means — and because it is only
    worth redoing when the extract itself is newer.
    """
    from . import dictionary
    if not KAIKKI_PATH.exists():
        print(f"missing {KAIKKI_PATH}; run `frcog fetch` first", file=sys.stderr)
        return 1
    con = connect()
    print("Dictionary")
    n = dictionary.build(con, KAIKKI_PATH, log=print)
    con.close()
    print("  run `frcog app` to export it beside the catalogue")
    return 0 if n else 1


def cmd_build(args) -> int:
    if not KAIKKI_PATH.exists():
        print(f"missing {KAIKKI_PATH}; run `frcog fetch` first", file=sys.stderr)
        return 1
    build.run(_cfg(args))
    from . import definitions
    con = connect()
    definitions.attach(con, log=print)
    con.close()
    return 0


def cmd_sentences(args) -> int:
    if not KAIKKI_PATH.exists():
        print(f"missing {KAIKKI_PATH}; run `frcog fetch` first", file=sys.stderr)
        return 1
    con = connect()
    print("Verb tables and example sentences")
    build.attach_sentences(con)
    con.close()
    return 0


def _recipes(cfg: Config) -> dict[str, str]:
    """The recipe in force for each stage, from this checkout: what a clip
    made now is stamped with."""
    from . import recipe as recipe_mod
    rec = recipe_mod.Recipe.load()
    return {name: m["hash"] for name, m in recipe_mod.current(rec.sources, cfg).items()}


def cmd_audio(args) -> int:
    cfg = _cfg(args)
    if args.lead_silence is not None:
        cfg.lead_silence_ms = args.lead_silence
    if args.tail_silence is not None:
        cfg.tail_silence_ms = args.tail_silence
    recipes = _recipes(cfg)
    con = connect()
    print("Audio")
    if args.repad:
        n = audio_mod.pad_all(con, cfg, force=args.force_repad)
        print(f"  padded {n} files")
        con.close()
        return 0
    if args.retrim:
        n = audio_mod.trim_all(con, cfg, force=args.force_retrim)
        print(f"  trimmed {n} files")
        con.close()
        return 0
    if not args.native_only and not args.english_only:
        audio_mod.synthesize_missing(con, cfg, limit=args.limit, recipe=recipes["audio"])
    if not args.tts_only and not args.english_only:
        audio_mod.fetch_human(con, cfg, limit=args.limit)
    if not args.native_only and not args.tts_only and not args.no_english:
        try:
            english.synthesize_missing(con, cfg, limit=args.limit, recipe=recipes["english"])
        except english.EnglishUnavailable as e:
            # Kokoro is an optional extra; the French clips are still worth
            # padding and counting without it. Only fail when English was
            # the whole point of the run.
            print(f"  {e}", file=sys.stderr)
            if args.english_only:
                con.close()
                return 1
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
        print(f"\n  The app:  http://localhost:{args.port}/")
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
        cmd_fetch(argparse.Namespace(accept_sources=False))
    cfg = _cfg(args)
    build.run(cfg)
    recipes = _recipes(cfg)
    con = connect()
    print("Audio")
    audio_mod.synthesize_missing(con, cfg, limit=args.limit, recipe=recipes["audio"])
    if not args.tts_only:
        audio_mod.fetch_human(con, cfg, limit=args.limit)
    try:
        english.synthesize_missing(con, cfg, limit=args.limit, recipe=recipes["english"])
    except english.EnglishUnavailable as e:
        # A deck tonight matters more than the English cue; the browser's voice will do.
        print(f"  {e}; the app will use the browser's voice", file=sys.stderr)
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
    p.add_argument("--english-voice", help="Kokoro voice for English cues (default af_heart)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("fetch", help="download the dumps the recipe pins, and pin them")
    s.add_argument("--accept-sources", action="store_true",
                   help="take an upstream file that moved since it was pinned, and re-pin it")
    s.set_defaults(func=cmd_fetch)

    s = sub.add_parser("build", help="build the ranking into SQLite")
    s.set_defaults(func=cmd_build)

    s = sub.add_parser("definitions", help="attach French definitions from the French Wiktionary")
    s.set_defaults(func=cmd_definitions)

    s = sub.add_parser("dictionary",
                       help="every glossed word, for adding one the ranking passed over")
    s.set_defaults(func=cmd_dictionary)

    s = sub.add_parser("sentences", help="rebuild verb tables and their example sentences")
    s.set_defaults(func=cmd_sentences)

    s = sub.add_parser("audio", help="generate TTS and fetch native recordings")
    s.add_argument("--limit", type=int)
    s.add_argument("--tts-only", action="store_true")
    s.add_argument("--native-only", action="store_true")
    s.add_argument("--english-only", action="store_true",
                   help="only the Kokoro English cues")
    s.add_argument("--no-english", action="store_true")
    s.add_argument("--repad", action="store_true",
                   help="only add leading silence to existing files")
    s.add_argument("--force-repad", action="store_true",
                   help="pad again even if already padded")
    s.add_argument("--retrim", action="store_true",
                   help="only settle the silence at each end of existing files (#68)")
    s.add_argument("--force-retrim", action="store_true",
                   help="settle again even if already done")
    s.add_argument("--lead-silence", type=int, metavar="MS",
                   help="milliseconds of silence before the voice (default 150)")
    s.add_argument("--tail-silence", type=int, metavar="MS",
                   help="milliseconds of silence after the voice (default 150)")
    s.set_defaults(func=cmd_audio)

    s = sub.add_parser("stats", help="show progress")
    s.set_defaults(func=cmd_stats)

    s = sub.add_parser("top", help="print the head of the ranking")
    s.add_argument("-n", type=int, default=40)
    s.add_argument("--offset", type=int, default=0)
    s.set_defaults(func=cmd_top)

    s = sub.add_parser("app", help="export JSON and serve the app")
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
