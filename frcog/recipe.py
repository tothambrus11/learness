"""What each generated thing is made from: `data/recipe.json`.

The database, the clips and the catalogue are committed, and they are made
by code, from dumps, with packages, all of which change. The recipe is the
record of which: the pin on every upstream dump (`sources.py`) and, for each
stage of the pipeline, a fingerprint of everything that decides its output.
Compare the recipe on disk with what the checkout would make today and the
answer to "does this need regenerating?" is a diff rather than a guess —
which is what let a catalogue be committed without the clips it named (#61).

A stage's fingerprint is a hash over five things: the source of every
package module the stage's entry modules import, transitively, found by
reading the imports rather than by a list somebody keeps by hand; the
values of the `Config` fields the stage reads (`config.RECIPE_GROUPS`);
the pins of the dumps it reads; the fingerprints of the stages before it
whose output it reads; and the installed versions of the third-party
packages whose behaviour shapes it. `config.py` itself is in every
closure and hashed in none, or a new voice would re-rank the deck.

The module is the grain. A comment moved in `audio.py` re-makes every
French clip, and that is accepted: hashing a parse of the source instead
of its bytes would make the fingerprint depend on the Python that parsed
it, and a recipe that differs between the maintainer's 3.11 and CI's 3.12
regenerates everything on every machine, which is worse than a rebuild
now and then. The modules are small and the closure is honest.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.metadata
import json
from dataclasses import dataclass, field
from pathlib import Path

from .config import DEFAULT, RECIPE_GROUPS, RECIPE_PATH, SOURCES, Config

PACKAGE = Path(__file__).resolve().parent

#: In every closure and hashed in none: the dials, which the groups cover
#: field by field so that a change to one reaches only the stages that read it.
UNFINGERPRINTED = ("config",)

#: How many hex digits of a sha256 a recipe keeps: enough that a collision
#: is not a concern, short enough to read in a diff.
DIGITS = 16


@dataclass(frozen=True)
class Stage:
    """One thing the pipeline makes, and what decides it.

    `modules` are the entry points; everything they import from the package
    is theirs too. `config` names a group in `RECIPE_GROUPS`, or is None
    for a stage no dial reaches. `sources` are pinned dumps, `after` the
    stages whose output this one reads, `packages` the distributions whose
    version is part of the recipe (`importlib.metadata` names, so
    `edge-tts`, not `edge_tts`)."""
    name: str
    modules: tuple[str, ...]
    config: str | None = None
    sources: tuple[str, ...] = ()
    after: tuple[str, ...] = ()
    packages: tuple[str, ...] = ()


#: The stages, in the order they run. Verified against what the commands
#: call: `frcog build` is `build.run` — which ranks, then rebuilds the verb
#: tables and every example sentence — then `definitions.attach`, and the
#: refresh runs `dictionary.build` with it, since the export ships the
#: dictionary. There is no separate sentences stage: `build.run` already
#: does that work, its closure already holds `sentences.py` (the ranking
#: reads the corpus, through `posuse` and `elision`), and its sources
#: already include the Tatoeba files, so nothing could make the sentences
#: stale without making the build stale with them.
STAGES: tuple[Stage, ...] = (
    Stage("build", ("build", "definitions", "dictionary"), config="build",
          sources=tuple(SOURCES), packages=("wordfreq", "rapidfuzz")),
    Stage("audio", ("audio",), config="audio", packages=("edge-tts",)),
    Stage("english", ("english",), config="english", packages=("kokoro",)),
    # The catalogue names the clips that are there, so a recipe that remade
    # them is a recipe that changes the export.
    Stage("export", ("webexport",), config="export", after=("build", "audio", "english")),
)


def stage(name: str) -> Stage:
    """The stage by name; a KeyError names an unknown one."""
    for s in STAGES:
        if s.name == name:
            return s
    raise KeyError(name)


def imports_of(source: str, package: str = "frcog") -> set[str]:
    """The package modules a piece of source imports, by reading it: every
    `from . import a, b`, `from .a import x`, `import frcog.a` and
    `from frcog.a import x`, wherever in the file it sits — a lazy import
    inside a function counts, since it runs. Third-party and standard
    library imports are not the package's and are left out."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            if node.level == 1 and node.module is None:
                found.update(alias.name for alias in node.names)
            elif node.level == 1 and node.module:
                found.add(node.module.split(".")[0])
            elif node.level == 0 and node.module == package:
                found.update(alias.name for alias in node.names)
            elif node.level == 0 and node.module and node.module.startswith(package + "."):
                found.add(node.module.split(".")[1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith(package + "."):
                    found.add(alias.name.split(".")[1])
    return found


def closure(module: str, package: Path = PACKAGE) -> set[str]:
    """Every module of the package that `module` reaches through imports,
    itself included, by a static read of the source — nothing is executed.
    A name that is not a module file in the package (`from .kaikki import
    Entry` names `kaikki`, and `Entry` is not a module) stops the walk."""
    seen: set[str] = set()
    todo = [module]
    while todo:
        name = todo.pop()
        path = package / f"{name}.py"
        if name in seen or not path.exists():
            continue
        seen.add(name)
        todo.extend(imports_of(path.read_text(encoding="utf-8"), package.name))
    return seen


def module_hash(name: str, package: Path = PACKAGE) -> str:
    """The source bytes of one module, hashed."""
    return hashlib.sha256((package / f"{name}.py").read_bytes()).hexdigest()[:DIGITS]


def hash_of(payload) -> str:
    """One hash over anything JSON can say, in a canonical form."""
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:DIGITS]


def installed(name: str) -> str:
    """The installed version of a distribution, or "absent"; the word is
    part of the recipe, so a run without Kokoro and one with it differ."""
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "absent"


def manifest(st: Stage, pins: dict[str, dict], upstream: dict[str, str], cfg: Config = DEFAULT,
             package: Path = PACKAGE, version=installed) -> dict:
    """Everything that decides a stage's output, spelt out, with its hash.

    The parts are kept in the recipe rather than only the hash, so that the
    diff of `recipe.json` in a pull request says *what* moved — which
    module, which dial, which package — and `frcog refresh --check` can
    say it in a line. `upstream` maps each stage in `after` to its current
    hash, and a stage that has none is "unrecorded", which is a value that
    matches nothing recorded."""
    modules = set()
    for entry in st.modules:
        modules |= closure(entry, package)
    modules -= set(UNFINGERPRINTED)
    fields = RECIPE_GROUPS.get(st.config, ()) if st.config else ()
    parts = {
        "modules": {m: module_hash(m, package) for m in sorted(modules)},
        # Normalised through JSON, so a tuple in Config and the list it was
        # saved as compare equal on the way back.
        "config": json.loads(json.dumps({f: getattr(cfg, f) for f in sorted(fields)})),
        "sources": {s: (hash_of(pins[s]) if pins.get(s) else "unpinned") for s in st.sources},
        "after": {a: upstream.get(a, "unrecorded") for a in st.after},
        "packages": {p: version(p) for p in st.packages},
    }
    parts["hash"] = hash_of(parts)
    return parts


def current(pins: dict[str, dict], cfg: Config = DEFAULT, package: Path = PACKAGE,
            version=installed) -> dict[str, dict]:
    """The manifest of every stage as this checkout would make it today, in
    run order, each later stage seeing the hashes of the ones before it."""
    out: dict[str, dict] = {}
    for st in STAGES:
        out[st.name] = manifest(st, pins, {n: m["hash"] for n, m in out.items()}, cfg, package,
                                version)
    return out


def why_stale(recorded: dict | None, fresh: dict) -> str | None:
    """One line on why a stage would run, or None when it would not: the
    modules, dials, dumps, upstream stages or packages that differ between
    what was recorded and what the checkout has."""
    if recorded is None:
        return "never recorded"
    if recorded.get("hash") == fresh["hash"]:
        return None
    reasons: list[str] = []
    for part, label in (("modules", "code"), ("config", "config"), ("sources", "dumps"),
                        ("after", "upstream")):
        before, now = recorded.get(part) or {}, fresh.get(part) or {}
        changed = sorted(k for k in set(before) | set(now) if before.get(k) != now.get(k))
        if changed:
            reasons.append(f"{label}: {', '.join(changed)}")
    before, now = recorded.get("packages") or {}, fresh.get("packages") or {}
    for name in sorted(set(before) | set(now)):
        if before.get(name) != now.get(name):
            reasons.append(f"{name} {before.get(name, 'unrecorded')} → {now.get(name, 'unrecorded')}")
    return "; ".join(reasons) or "recorded differently"


def catalogue_hash(stages: dict[str, dict]) -> str:
    """What a catalogue says it was made from: one hash over the recorded
    hash of every stage. A stage never recorded counts as such, so a
    catalogue exported without English cues does not claim them."""
    return hash_of({name: (m or {}).get("hash", "unrecorded") for name, m in stages.items()})


@dataclass
class Recipe:
    """The file, read into memory: the pins by source name, and each stage's
    manifest by stage name. Either is empty on a checkout that never ran
    `frcog refresh`."""
    sources: dict[str, dict] = field(default_factory=dict)
    stages: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path = RECIPE_PATH) -> "Recipe":
        """The recipe as committed; an empty one where the file is missing,
        so a first run and a fresh checkout are the same case."""
        if not Path(path).exists():
            return cls()
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(sources=dict(data.get("sources") or {}), stages=dict(data.get("stages") or {}))

    def save(self, path: Path = RECIPE_PATH) -> None:
        """Written sorted and indented, so a change to one pin or one stage
        is a few lines in a diff that a person can read in the pull request."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(
            json.dumps({"sources": self.sources, "stages": self.stages},
                       indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8")
