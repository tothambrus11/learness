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
from frcog.recipe import Recipe


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
