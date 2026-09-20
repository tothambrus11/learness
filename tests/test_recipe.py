"""What the pipeline's outputs were made from, and how it knows.

Twice a commit took the catalogue and not the database and clips it was
exported from (#61: 117 words whose recordings never existed on the server).
The recipe is the pipeline's own answer to "is what ships what the recipe in
version control says?": a pin on every upstream dump, and a fingerprint per
stage over the code, the configuration, the dumps and the packages that
decide its output. The network is stood in for throughout; nothing here
downloads anything.
"""
from __future__ import annotations

import pytest

from frcog import sources
from frcog.config import SOURCES
from frcog.recipe import code_of, Recipe


# --- the pins ---------------------------------------------------------------

class FakeResponse:
    def __init__(self, headers: dict, body: bytes = b"", status: int = 200):
        self.headers = headers
        self.body = body
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def iter_content(self, size):
        for i in range(0, len(self.body), size):
            yield self.body[i:i + size]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeUpstream:
    """kaikki.org and Tatoeba, as far as the pins can see them: one file per
    URL with the headers a server sends about it, and a record of every
    request, so a test can say that none was made."""

    def __init__(self):
        self.files: dict[str, tuple[dict, bytes]] = {}
        self.calls: list[tuple[str, str]] = []

    def serve(self, name: str, etag: str = '"v1"', modified: str = "Mon, 01 Sep 2026 00:00:00 GMT",
              body: bytes = b"a dump") -> None:
        self.files[SOURCES[name].url] = (
            {"ETag": etag, "Last-Modified": modified, "Content-Length": str(len(body))}, body)

    def head(self, url, allow_redirects=True, timeout=None):
        self.calls.append(("HEAD", url))
        headers, _ = self.files[url]
        return FakeResponse(headers)

    def get(self, url, stream=True, timeout=None):
        self.calls.append(("GET", url))
        headers, body = self.files[url]
        return FakeResponse(headers, body)


@pytest.fixture()
def upstream() -> FakeUpstream:
    up = FakeUpstream()
    for name in SOURCES:
        up.serve(name)
    return up


def test_a_dump_already_on_disk_is_pinned_from_a_head_and_not_downloaded_again(tmp_path, upstream):
    """The first run on the maintainer's machine: 3.8 GB on disk, no pins yet."""
    (tmp_path / SOURCES["cmudict"].file).write_bytes(b"old dump")
    pins: dict = {}
    done = sources.ensure(pins, http=upstream, raw=tmp_path, log=lambda *_: None, names=("cmudict",))
    assert done == {"cmudict": "pinned"}
    assert pins["cmudict"]["etag"] == '"v1"'
    assert pins["cmudict"]["bytes"] == len(b"a dump")
    assert [m for m, _ in upstream.calls] == ["HEAD"], "asked about, never fetched"
    assert (tmp_path / SOURCES["cmudict"].file).read_bytes() == b"old dump"


def test_a_dump_that_is_missing_is_fetched_and_pinned_from_the_bytes_it_came_with(tmp_path, upstream):
    pins: dict = {}
    done = sources.ensure(pins, http=upstream, raw=tmp_path, log=lambda *_: None, names=("cmudict",))
    assert done == {"cmudict": "fetched"}
    assert (tmp_path / SOURCES["cmudict"].file).read_bytes() == b"a dump"
    assert pins["cmudict"] == {"url": SOURCES["cmudict"].url, "etag": '"v1"',
                               "lastModified": "Mon, 01 Sep 2026 00:00:00 GMT", "bytes": 6}
    assert not list(tmp_path.glob("*.part")), "nothing half-written left beside it"


def test_a_pinned_dump_on_disk_is_not_even_asked_about(tmp_path, upstream):
    """A refresh with everything in place makes no request: the pin says the
    file is the one, and asking would only invite the answer that the world
    moved, which is not this run's business."""
    (tmp_path / SOURCES["cmudict"].file).write_bytes(b"a dump")
    pins = {"cmudict": sources.pin_of(SOURCES["cmudict"].url, upstream.files[SOURCES["cmudict"].url][0])}
    done = sources.ensure(pins, http=upstream, raw=tmp_path, log=lambda *_: None, names=("cmudict",))
    assert done == {"cmudict": "kept"}
    assert upstream.calls == []


def test_a_pin_refuses_an_upstream_that_moved_until_it_is_accepted(tmp_path, upstream):
    """The dumps are not versioned upstream, so once the new file is taken the
    deck the old pin belongs to can never be rebuilt. A fresh checkout (CI,
    after a cache miss) that finds kaikki.org has re-exported therefore stops
    and says so, rather than quietly ranking a different Wiktionary."""
    pins = {"cmudict": {"url": SOURCES["cmudict"].url, "etag": '"v0"',
                        "lastModified": "Sun, 01 Mar 2026 00:00:00 GMT", "bytes": 6}}
    with pytest.raises(sources.SourceMoved) as refused:
        sources.ensure(pins, http=upstream, raw=tmp_path, log=lambda *_: None, names=("cmudict",))
    assert "cmudict" in str(refused.value)
    assert '"v0"' in str(refused.value) and '"v1"' in str(refused.value), "both versions named"
    assert "--accept-sources" in str(refused.value)
    assert not (tmp_path / SOURCES["cmudict"].file).exists(), "nothing taken"
    assert pins["cmudict"]["etag"] == '"v0"', "the pin of record stands"

    done = sources.ensure(pins, accept=True, http=upstream, raw=tmp_path, log=lambda *_: None,
                          names=("cmudict",))
    assert done == {"cmudict": "replaced"}
    assert pins["cmudict"]["etag"] == '"v1"', "accepted: the new file is the pin now"
    assert (tmp_path / SOURCES["cmudict"].file).read_bytes() == b"a dump"


def test_accepting_sources_with_everything_on_disk_replaces_only_what_moved(tmp_path, upstream):
    for name in ("cmudict", "fra_sentences"):
        (tmp_path / SOURCES[name].file).write_bytes(b"a dump")
    pins = {"cmudict": sources.pin_of(SOURCES["cmudict"].url, upstream.files[SOURCES["cmudict"].url][0]),
            "fra_sentences": {"url": SOURCES["fra_sentences"].url, "etag": '"old"',
                              "lastModified": None, "bytes": 6}}
    done = sources.ensure(pins, accept=True, http=upstream, raw=tmp_path, log=lambda *_: None,
                          names=("cmudict", "fra_sentences"))
    assert done == {"cmudict": "kept", "fra_sentences": "replaced"}
    assert [(m, u.rsplit("/", 1)[1]) for m, u in upstream.calls] == [
        ("HEAD", "cmudict.dict"), ("HEAD", "fra_sentences.tsv.bz2"), ("GET", "fra_sentences.tsv.bz2")]


def test_a_header_the_server_stopped_sending_is_not_a_moved_file():
    """Only a value both sides have is compared: a CDN that drops the ETag
    has not changed the extract, and a pin must not refuse over it."""
    pinned = {"url": "u", "etag": '"v1"', "lastModified": "then", "bytes": 10}
    assert sources.moved(pinned, {"url": "u", "etag": None, "lastModified": "then", "bytes": 10}) is None
    assert sources.moved(pinned, {"url": "u", "etag": '"v2"', "lastModified": "then", "bytes": 10})
    assert sources.moved(pinned, {"url": "u", "etag": '"v1"', "lastModified": "then", "bytes": 11})
    assert sources.moved(pinned, {"url": "elsewhere", "etag": '"v1"', "lastModified": "then",
                                  "bytes": 10}), "the same headers from another url is another file"
    assert sources.moved(None, {"url": "u", "etag": '"v1"', "lastModified": None, "bytes": 10}) is None


def test_the_sentences_module_names_the_same_tatoeba_files_the_registry_does():
    """`frcog build` asks `sentences.missing_files` whether the corpus is
    there; the fetch and the pins go by the registry. Two lists of three
    file names would drift, so one is derived from the other."""
    from frcog import sentences
    assert set(sentences.CORPUS_FILES) == {"fra_sentences.tsv.bz2", "eng_sentences.tsv.bz2",
                                           "fra-eng_links.tsv.bz2"}
    assert all(url.startswith("https://downloads.tatoeba.org/") for url in sentences.CORPUS_FILES.values())


def test_the_recipe_file_round_trips_and_is_empty_where_there_is_none(tmp_path):
    path = tmp_path / "recipe.json"
    assert Recipe.load(path) == Recipe(), "a fresh checkout is the same as a first run"
    rec = Recipe(sources={"cmudict": {"url": "u", "etag": None, "lastModified": None, "bytes": 3}},
                 stages={"build": {"hash": "abc"}})
    rec.save(path)
    assert Recipe.load(path) == rec
    text = path.read_text()
    assert text.endswith("}\n") and "\n " in text, "one field per line, for a diff a person reads"


# --- the stage recipes ------------------------------------------------------

from dataclasses import fields as dataclass_fields  # noqa: E402

from frcog import recipe  # noqa: E402
from frcog.config import RECIPE_GROUPS, UNRECIPED, Config  # noqa: E402
from frcog.recipe import STAGES, Stage, catalogue_hash, closure, current, manifest, why_stale  # noqa: E402


def package(tmp_path, **modules: str):
    """A package on disk, named like the real one so absolute imports resolve."""
    pkg = tmp_path / "frcog"
    pkg.mkdir(exist_ok=True)
    for name, source in modules.items():
        (pkg / f"{name}.py").write_text(source)
    return pkg


def test_the_closure_follows_the_package_imports_and_stops_at_the_package_edge(tmp_path):
    """Whichever way a module is imported, and wherever in the file — a lazy
    import inside a function runs, so it counts — and never past the
    package: `json` and `requests` are not the pipeline's to fingerprint."""
    pkg = package(
        tmp_path,
        a="import json\nfrom . import b, config\nfrom .c import thing\n\ndef f():\n    from frcog.d import x\n",
        b="import requests\nimport frcog.e\n",
        c="from frcog import f\n",
        d="",
        e="",
        f="",
        lonely="from . import a\n",
        config="",
    )
    assert closure("a", pkg) == {"a", "b", "c", "d", "e", "f", "config"}
    assert "lonely" not in closure("a", pkg), "importing a does not make lonely part of a"
    assert closure("d", pkg) == {"d"}


def test_a_name_that_is_not_a_module_stops_the_walk(tmp_path):
    """`from .kaikki import Entry` names a module and a class; only the module
    is walked, and a bare name with no file behind it is not an error."""
    pkg = package(tmp_path, a="from .b import Thing\nfrom . import nothing\n", b="")
    assert closure("a", pkg) == {"a", "b"}


def fingerprint(pkg, st: Stage, cfg=None) -> str:
    return manifest(st, {}, {}, cfg or Config(), package=pkg, version=lambda _p: "1.0")["hash"]


def test_a_stage_changes_when_a_module_in_its_closure_changes_and_not_when_one_outside_does(tmp_path):
    """The rule the whole recipe rests on: regenerate a thing only when
    something about how it is made changed. A comment moved in the export
    must not re-synthesise five thousand clips."""
    pkg = package(tmp_path, a="from . import b\n", b="x = 1\n", c="y = 1\n", config="")
    st = Stage("s", ("a",))
    before = fingerprint(pkg, st)
    (pkg / "c.py").write_text("y = 2  # a comment moved\n")
    assert fingerprint(pkg, st) == before, "c is not in a's closure"
    (pkg / "b.py").write_text("x = 2\n")
    assert fingerprint(pkg, st) != before, "b is"


def test_config_is_in_every_closure_and_hashed_in_none():
    """Every module imports the dials, so hashing config.py would make a new
    voice re-rank the deck; a dial reaches a stage through its group instead."""
    for st in STAGES:
        m = manifest(st, {}, {}, version=lambda _p: "1.0")
        assert "config" not in m["modules"], st.name
        assert all("config" in closure(e) for e in st.modules), st.name


def stale_after(change: dict) -> set[str]:
    """Which real stages a change to the dials would make stale."""
    base = current({}, Config(), version=lambda _p: "1.0")
    changed = current({}, Config(**change), version=lambda _p: "1.0")
    return {name for name in base if base[name]["hash"] != changed[name]["hash"]}


def test_a_dial_in_a_stages_group_changes_that_stage_and_what_reads_its_output():
    assert stale_after({"tts_voice": "fr-CH-FabriceNeural"}) == {"audio", "export"}, (
        "a new voice re-makes the French clips, and the catalogue that names them; not the deck")
    assert stale_after({"english_voice": "bf_emma"}) == {"english", "export"}
    assert stale_after({"similarity_alpha": 2.0}) == {"build", "export"}, (
        "a re-ranked deck is a new catalogue; the clips are keyed by word and stay")
    assert stale_after({"lead_silence_ms": 300}) == {"audio", "english", "export"}, (
        "the margin shapes both kinds of clip")
    assert stale_after({"audio_concurrency": 1}) == set(), "how fast is not what"


def test_every_config_field_is_in_a_group_or_named_as_unreciped():
    """A dial added to Config and forgotten by the recipe is a change that
    regenerates nothing; this is the test that names it."""
    grouped = {f for group in RECIPE_GROUPS.values() for f in group}
    every = {f.name for f in dataclass_fields(Config)}
    assert every - grouped - set(UNRECIPED) == set(), "add it to a group in RECIPE_GROUPS or to UNRECIPED"
    assert grouped & set(UNRECIPED) == set(), "a dial is one or the other"
    assert grouped - every == set(), "a group names a field that is no longer there"


def test_the_stages_reach_what_the_commands_actually_run():
    """Checked against the code rather than a table: the build reads the
    corpus while ranking (the noun-position rule in posuse, the elision rule)
    and rebuilds the verb tables and sentences in `build.run`, so
    `sentences.py` and the Tatoeba pins are the build's; the English cues
    are trimmed by `audio.settle_edges`, so audio.py is theirs too."""
    build = closure("build")
    assert {"sentences", "posuse", "elision", "conjugation", "kaikki", "similarity", "freq"} <= build
    assert set(recipe.stage("build").sources) == {"kaikki-fr", "kaikki-frwikt", "cmudict",
                                                  "fra_sentences", "eng_sentences", "fra-eng_links"}
    assert "audio" in closure("english")
    assert "build" not in closure("audio"), "a ranking change does not re-make a clip"
    assert closure("webexport") >= {"webexport", "sentences", "function", "english", "audio"}
    assert [s.name for s in STAGES] == ["build", "audio", "english", "export"], "in run order"


def test_a_package_version_is_part_of_the_recipe_and_absent_is_a_version():
    versions = {"wordfreq": "3.1.1", "rapidfuzz": "3.14.6", "edge-tts": "7.2.8", "kokoro": "absent"}
    one = current({}, version=lambda p: versions.get(p, "absent"))
    versions["wordfreq"] = "3.2.0"
    two = current({}, version=lambda p: versions.get(p, "absent"))
    assert one["build"]["hash"] != two["build"]["hash"], "a new wordfreq is a new ranking"
    assert one["audio"]["hash"] == two["audio"]["hash"]
    assert one["english"]["packages"] == {"kokoro": "absent"}
    assert why_stale(one["build"], two["build"]) == "wordfreq 3.1.1 → 3.2.0"


def test_a_pin_is_part_of_the_stages_that_read_the_dump():
    pin = {"url": "u", "etag": '"v1"', "lastModified": None, "bytes": 5}
    one = current({"cmudict": pin}, version=lambda _p: "1.0")
    two = current({"cmudict": {**pin, "etag": '"v2"'}}, version=lambda _p: "1.0")
    assert one["build"]["hash"] != two["build"]["hash"]
    assert one["audio"]["hash"] == two["audio"]["hash"], "the clips do not read the dictionary"
    assert why_stale(one["build"], two["build"]) == "dumps: cmudict"
    assert why_stale(None, two["build"]) == "never recorded"
    assert why_stale(one["build"], one["build"]) is None


def test_why_a_stage_is_stale_names_the_module_and_the_dial(tmp_path):
    pkg = package(tmp_path, build="from . import b\n", b="x = 1\n", definitions="", dictionary="",
                  audio="", english="", webexport="", config="")
    before = current({}, Config(), pkg, version=lambda _p: "1.0")
    (pkg / "b.py").write_text("x = 2\n")
    after = current({}, Config(top_n=5), pkg, version=lambda _p: "1.0")
    assert why_stale(before["build"], after["build"]) == "code: b; config: top_n"
    assert why_stale(before["export"], after["export"]) == "upstream: build"


def test_the_catalogue_hash_is_over_the_recorded_stages_and_says_when_one_is_missing():
    stages = current({}, version=lambda _p: "1.0")
    whole = catalogue_hash(stages)
    assert whole == catalogue_hash(dict(reversed(list(stages.items())))), "order does not matter"
    without = {k: v for k, v in stages.items() if k != "english"}
    assert catalogue_hash(without) != whole, "a catalogue without cues does not claim them"
    assert len(whole) == 16


def test_a_comment_or_a_docstring_changed_in_a_module_of_the_closure_changes_nothing(tmp_path):
    """The recipe hashes the code, not the file. A comment moved in
    `audio.py` used to remake every French clip and, since `english.py`
    imports it, every cue: two hours of Kokoro and 160 MB of churn for a
    sentence nobody hears."""
    pkg = package(tmp_path, a='"""A module."""\n\nx = 1  # one\n\n\ndef f():\n    """Says f."""\n    return x\n',
                  config="")
    st = Stage("s", ("a",))
    before = fingerprint(pkg, st)
    (pkg / "a.py").write_text('"""A module, reworded."""\nx = 1  # two\n\ndef f():\n    """Says f, at length: é."""\n\n    return x   \n')
    assert fingerprint(pkg, st) == before, "only words that do not run changed"
    (pkg / "a.py").write_text('"""A module."""\nx = 2  # one\ndef f():\n    """Says f."""\n    return x\n')
    assert fingerprint(pkg, st) != before, "the value changed"


def test_a_docstring_with_accents_is_cut_out_whole():
    """The parser counts columns in bytes; a docstring with an é in it used
    to leave a byte of itself behind or eat the code after it."""
    assert code_of('def f():\n    """Élan, déjà."""; return 1\n') == "def f():\n    ; return 1"
    assert code_of('"""À part."""\nx = 1\ny = 2\n') == "x = 1\ny = 2"
    assert code_of('x = 1\n"""À part."""\n') == 'x = 1\n"""À part."""', "a string that is not first is code"
