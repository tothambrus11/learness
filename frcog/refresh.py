"""One command that brings everything up to the recipe: `frcog refresh`.

The database, the clips and the catalogue are committed, and for a while
they were made on the maintainer's machine by a shell script that ran
every stage and left the commit to a person — which is how, twice, the
catalogue was committed without the database and the clips it was
exported from (#61). This is the script's replacement, and it differs in
two ways: it does only what the recipe says is out of date, and it
records what it did, so a run on a clean checkout (CI) makes the same
thing and a second run makes nothing.

In order: the upstream dumps are put on disk and pinned; each stage is
compared with `data/recipe.json` and run when its recipe differs or was
never recorded; the audio passes run every time, since a clip is judged
one by one and a pass with nothing stale costs nothing (`audio.judge`);
the export runs when its own recipe changed or any stage before it ran.
After each stage its recipe is recorded, so a run cut off half way leaves
a recipe that says exactly how far it got. `--check` prints the plan and
touches nothing, on the network or on disk: exit 1 when a run would do
something, 0 when it is up to date.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import requests

from . import audio as audio_mod
from . import build, english, recipe as recipe_mod, sources, webexport
from .audio import Outcome
from .config import (DB_PATH, DEFAULT, FRWIKT_PATH, KAIKKI_PATH, RAW, RECIPE_PATH, SOURCES,
                     Config)
from .db import connect
from .recipe import PACKAGE, Recipe


@dataclass
class Options:
    """The flags. `check` plans and stops; `accept_sources` takes an
    upstream dump that moved since it was pinned; `native` also fetches
    the human recordings from Wikimedia, which rate-limits and which
    nothing depends on, so CI does not do it unasked; `limit` caps the
    words each audio pass looks at, for a trial run."""
    check: bool = False
    accept_sources: bool = False
    native: bool = False
    limit: int | None = None


@dataclass
class Paths:
    """Where everything is, so a test can point the whole run at a
    temporary directory. `catalogue` None is the app's own."""
    recipe: Path = RECIPE_PATH
    db: Path = DB_PATH
    raw: Path = RAW
    catalogue: Path | None = None
    package: Path = PACKAGE


#: What each audio pass would do, counted by `audio.KINDS`.
Counts = dict[str, int]


@dataclass
class Plan:
    """What a run would do and why, one line per thing, as `--check` prints
    it and the report repeats it."""
    sources: dict[str, str] = field(default_factory=dict)   # name -> state
    stale: dict[str, str] = field(default_factory=dict)     # stage -> why, in run order
    clips: dict[str, Counts] = field(default_factory=dict)  # "audio" / "english" -> counts

    def work(self) -> bool:
        """Whether a run would do anything at all."""
        if self.stale:
            return True
        if any("not " in state for state in self.sources.values()):
            return True
        return any(c.get(k, 0) for c in self.clips.values() for k in ("missing", "text", "recipe", "adopt"))

    def lines(self) -> list[str]:
        out = [f"- source {line}" for line in self.sources.values()]
        for st in recipe_mod.STAGES:
            why = self.stale.get(st.name)
            line = f"- {st.name}: " + (f"stale — {why}" if why else "up to date")
            counts = self.clips.get(st.name)
            if counts:
                todo = counts.get("missing", 0) + counts.get("text", 0) + counts.get("recipe", 0)
                line += (f"; {todo} clips to make ({counts.get('missing', 0)} missing, "
                         f"{counts.get('text', 0)} say the wrong thing, "
                         f"{counts.get('recipe', 0)} by another recipe), "
                         f"{counts.get('adopt', 0)} to adopt, {counts.get('kept', 0)} fine")
            out.append(line)
        return out


def _counts(clips) -> Counts:
    out: Counts = {}
    for c in clips:
        out[c.kind] = out.get(c.kind, 0) + 1
    return out


def plan(rec: Recipe, current: dict[str, dict], con: sqlite3.Connection | None, cfg: Config,
         paths: Paths, limit: int | None = None) -> Plan:
    """Compare the recorded recipe with the current one, and the clips on
    disk with what the cards say. `con` None means there is no database
    yet, which is a build and nothing to count."""
    p = Plan()
    for name in SOURCES:
        p.sources[name] = sources.describe(name, rec.sources, paths.raw)
    for st in recipe_mod.STAGES:
        why = recipe_mod.why_stale(rec.stages.get(st.name), current[st.name])
        if why:
            p.stale[st.name] = why
    if con is not None:
        p.clips["audio"] = _counts(audio_mod.triage_tts(con, cfg, current["audio"]["hash"], limit))
        p.clips["english"] = _counts(english.triage(con, cfg, current["english"]["hash"], limit))
    return p


# --- the stages, as the refresh runs them --------------------------------------
#
# Module-level so a test can hand in its own; each takes what it needs and
# returns what the report says about it.

def build_stage(con: sqlite3.Connection, cfg: Config, paths: Paths, log) -> dict[str, int]:
    """`frcog build` and `frcog dictionary` in one: the ranking, the verb
    tables and every example sentence, the French definitions, and the
    dictionary the words screen fills a form from."""
    from . import definitions, dictionary
    build.run(cfg, KAIKKI_PATH, paths.db, log=log)
    definitions.attach(con, FRWIKT_PATH, log=log)
    dictionary.build(con, KAIKKI_PATH, cfg, log=log)
    q = lambda s: con.execute(s).fetchone()[0]
    return {
        "words": q("SELECT COUNT(*) FROM words WHERE active=1"),
        "verbs": q("SELECT COUNT(*) FROM words WHERE active=1 AND conjugation IS NOT NULL"),
        "with sentences": q("SELECT COUNT(DISTINCT word_id) FROM examples"),
        "with definitions": q("SELECT COUNT(*) FROM words WHERE active=1 AND definitions IS NOT NULL"),
        "dictionary": q("SELECT COUNT(*) FROM dictionary"),
    }


def audio_stage(con: sqlite3.Connection, cfg: Config, recipe: str, limit: int | None, log) -> Outcome:
    return audio_mod.synthesize_missing(con, cfg, limit=limit, log=log, recipe=recipe)


def native_stage(con: sqlite3.Connection, cfg: Config, limit: int | None, log) -> int:
    return audio_mod.fetch_human(con, cfg, limit=limit, log=log)


def english_stage(con: sqlite3.Connection, cfg: Config, recipe: str, limit: int | None, log) -> Outcome:
    """Raises `EnglishUnavailable` when there are cues to make and no Kokoro."""
    return english.synthesize_missing(con, cfg, limit=limit, log=log, recipe=recipe)


def export_stage(con: sqlite3.Connection, cfg: Config, catalogue: str, paths: Paths, log) -> Path:
    return webexport.export(con, paths.catalogue, cfg=cfg, log=log, media=audio_mod.media_dir(cfg),
                            recipe=catalogue)


RUNNERS = {"build": build_stage, "audio": audio_stage, "native": native_stage,
           "english": english_stage, "export": export_stage}


def _outcome_line(what: str, o: Outcome) -> str:
    return (f"- {what}: {o.made} made ({o.remade} remade), {o.adopted} adopted, {o.kept} kept, "
            f"{o.failed} failed; {o.have} with a clip")


def run(opts: Options, cfg: Config = DEFAULT, paths: Paths = Paths(), log=print, http=requests,
        runners=RUNNERS) -> tuple[int, str]:
    """The refresh. Returns the exit code and the report, which is what the
    workflow puts in the pull request: what ran, the counts, the recipes.
    Nothing is printed here but the stages' own progress, through `log`.

    With `check`, the sources are not ensured and nothing is written; the
    plan is the report and the code says whether a run would do anything.
    """
    rec = Recipe.load(paths.recipe)
    report: list[str] = ["## Pipeline refresh", ""]

    if not opts.check:
        try:
            done = sources.ensure(rec.sources, accept=opts.accept_sources, http=http,
                                  raw=paths.raw, log=log)
        except sources.SourceMoved as e:
            rec.save(paths.recipe)             # the pins settled before the refusal stand
            report += ["Refused: " + str(e), ""]
            return 1, "\n".join(report)
        rec.save(paths.recipe)
        by_what: dict[str, list[str]] = {}
        for name, what in done.items():
            by_what.setdefault(what, []).append(name)
        report.append("Sources: " + ", ".join(f"{len(v)} {k}" for k, v in sorted(by_what.items())))

    current = recipe_mod.current(rec.sources, cfg, paths.package)
    con = connect(paths.db) if paths.db.exists() or not opts.check else None
    pl = plan(rec, current, con, cfg, paths, opts.limit)

    if opts.check:
        report += ["Plan:"] + pl.lines()
        if con is not None:
            con.close()
        return (1 if pl.work() else 0), "\n".join(report)
    assert con is not None
    # A fetch of the human recordings is asked for, not planned: nothing
    # depends on them, so nothing else knows whether they are missing.
    if not pl.work() and not opts.native:
        con.close()
        report += ["", "Up to date: nothing to do."] + _recipe_lines(rec)
        return 0, "\n".join(report)

    report += ["", "Stages:"] + [f"- {name}: {why}" for name, why in pl.stale.items()]
    report += [""] if pl.stale else []
    ran: list[str] = []

    if "build" in pl.stale:
        log("Build")
        counts = runners["build"](con, cfg, paths, log)
        rec.stages["build"] = current["build"]
        rec.save(paths.recipe)
        ran.append("build")
        report.append("- build: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
        # The stages after it are judged against a build that now exists.
        current = recipe_mod.current(rec.sources, cfg, paths.package)

    log("Audio")
    failed = 0
    o = runners["audio"](con, cfg, current["audio"]["hash"], opts.limit, log)
    rec.stages["audio"] = current["audio"]
    rec.save(paths.recipe)
    if "audio" in pl.stale or o.made or o.failed:
        ran.append("audio")
    failed += o.failed
    report.append(_outcome_line("audio", o))

    if opts.native:
        n = runners["native"](con, cfg, opts.limit, log)
        ran.append("native")
        report.append(f"- native: {n} words with a human recording")

    try:
        o = runners["english"](con, cfg, current["english"]["hash"], opts.limit, log)
    except english.EnglishUnavailable as e:
        # Not done, and not recorded: the next run with Kokoro present does
        # the cues, and until then the recipe says english is stale.
        log(f"  {e}")
        report.append(f"- english: not done ({e})")
    else:
        rec.stages["english"] = current["english"]
        rec.save(paths.recipe)
        if "english" in pl.stale or o.made or o.failed:
            ran.append("english")
        failed += o.failed
        report.append(_outcome_line("english", o))

    audio_mod.pad_all(con, cfg, log=log)

    if "export" in pl.stale or ran:
        log("Export")
        catalogue = recipe_mod.catalogue_hash({**rec.stages, "export": current["export"]})
        out = runners["export"](con, cfg, catalogue, paths, log)
        rec.stages["export"] = current["export"]
        rec.save(paths.recipe)
        ran.append("export")
        n = con.execute("SELECT COUNT(*) FROM words WHERE active=1").fetchone()[0]
        report.append(f"- export: {n} words -> {out}")
    con.close()
    report += ["", "Ran: " + (", ".join(ran) or "nothing")] + _recipe_lines(rec)
    if failed:
        # A clip that could not be made is a word without a voice. The
        # export has already left it out honestly, and the next run will try
        # it again since it is still missing — but a run that ends short of
        # the recipe is not a run that passed, and on CI a green job with
        # 118 words gone quiet is exactly the silence #61 was (the first run
        # of this command did that, behind a proxy the voice would not speak
        # through).
        report += ["", f"Not done: {failed} clips could not be made; the log says why each."]
        return 1, "\n".join(report)
    return 0, "\n".join(report)


def _recipe_lines(rec: Recipe) -> list[str]:
    out = ["", "Recipe:"]
    for st in recipe_mod.STAGES:
        m = rec.stages.get(st.name)
        out.append(f"- {st.name}: {m['hash'] if m else 'not recorded'}")
    out.append(f"- catalogue: {recipe_mod.catalogue_hash(rec.stages)}")
    return out
