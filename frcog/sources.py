"""The upstream dumps, and the pin on each.

The pipeline reads six files nobody here wrote: two Wiktionary extracts from
kaikki.org, the CMU pronouncing dictionary, and three Tatoeba exports. None
of those upstreams versions what it publishes — each overwrites the same URL
on every export — so the only record of *which* extract a deck was ranked
from is what the server said about the file when it was taken: its `ETag`,
its `Last-Modified` and its length. That is the pin, kept in
`data/recipe.json` beside the stage recipes, and it is the reason a change
upstream is a deliberate act here rather than something a run picks up in
passing: a pin can detect that the world moved, and never fetch the old
world back. A fresh checkout that finds the upstream changed under its pin
refuses, and names the two versions, until it is told to accept
(`frcog refresh --accept-sources`); the re-pinned file is then committed as
the new pin of record, with the regeneration it caused.

Every request goes through the `http` object handed in, `requests` by
default, so a test can stand the upstreams in without a network.
"""
from __future__ import annotations

from pathlib import Path

import requests

from .config import RAW, SOURCES

#: The three header values a pin is made of, by the key they are kept under.
_HEADERS = (("etag", "ETag"), ("lastModified", "Last-Modified"), ("bytes", "Content-Length"))

TIMEOUT = 120


class SourceMoved(RuntimeError):
    """An upstream file is not the one the recipe was made from, and nobody
    said to take the new one. The message names the source and both
    versions, and is what the refresh prints before it stops."""


def pin_of(url: str, headers) -> dict:
    """What the upstream said about the file: the pin as it is recorded.

    `bytes` is an int, the other two strings, and a header the server did
    not send is None rather than absent, so two pins compare field by field.
    The url is part of the pin: a file fetched from somewhere else is a
    different file, however alike the headers."""
    pin: dict = {"url": url}
    for key, header in _HEADERS:
        value = headers.get(header)
        if key == "bytes" and value is not None:
            try:
                value = int(value)
            except ValueError:
                value = None
        pin[key] = value
    return pin


def moved(pinned: dict | None, fresh: dict) -> str | None:
    """How the upstream differs from the pin, in one sentence, or None when
    it is the same file as far as the headers can tell.

    Only a value both sides have is compared: a server that stopped sending
    an ETag has not changed the file. A pin with no header at all in common
    with the fresh one cannot be told apart, and is taken as unchanged —
    the length is always there in practice, so this is the rare case.
    """
    if pinned is None:
        return None
    for key in ("url", "etag", "lastModified", "bytes"):
        before, now = pinned.get(key), fresh.get(key)
        if before is not None and now is not None and before != now:
            return f"{key} was {before!r}, upstream now says {now!r}"
    return None


def head(name: str, http=requests) -> dict:
    """The pin the upstream would give the file today. One HEAD request."""
    src = SOURCES[name]
    resp = http.head(src.url, allow_redirects=True, timeout=TIMEOUT)
    resp.raise_for_status()
    return pin_of(src.url, resp.headers)


def download(name: str, http=requests, raw: Path = RAW, log=print) -> dict:
    """Fetch one dump into `raw` and return its pin, from the headers of the
    response the bytes actually came from.

    Written to a `.part` beside the file and moved into place at the end, so
    an interrupted download leaves nothing that looks like a dump: a cut-off
    extract is otherwise "already there" on the next run and read to its
    end as if that were the end."""
    src = SOURCES[name]
    raw.mkdir(parents=True, exist_ok=True)
    dest = raw / src.file
    part = dest.with_name(dest.name + ".part")
    log(f"  downloading {src.url}")
    with http.get(src.url, stream=True, timeout=TIMEOUT) as resp:
        resp.raise_for_status()
        pin = pin_of(src.url, resp.headers)
        total = pin["bytes"] or 0
        done = 0
        with open(part, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total > (50 << 20) and done % (50 << 20) < (1 << 20):
                    log(f"    {done / 1e6:.0f}/{total / 1e6:.0f} MB")
    part.replace(dest)
    log(f"  saved {dest} ({dest.stat().st_size / 1e6:.0f} MB)")
    return pin


def present(name: str, raw: Path = RAW) -> bool:
    """Whether the dump is on disk. A `.part` is not a dump."""
    return (raw / SOURCES[name].file).exists()


def ensure(pins: dict[str, dict], accept: bool = False, http=requests, raw: Path = RAW,
           log=print, names=tuple(SOURCES)) -> dict[str, str]:
    """Bring every dump on disk into agreement with its pin, updating `pins`
    in place, and say what was done to each: "kept", "pinned", "fetched" or
    "replaced".

    The rules, in the order a checkout meets them:

    * on disk and pinned: nothing to do, and no request is made — unless
      `accept`, when the upstream is asked and a file that moved is fetched
      again and re-pinned;
    * on disk and not pinned (the first run on a machine that already had the
      dumps): pinned from a HEAD, on the assumption that what is on disk is
      what the upstream has, which is the best that can be done for a file
      taken before pins existed;
    * not on disk: fetched and pinned — but a pin that the upstream no longer
      matches is refused with `SourceMoved`, unless `accept`, because the
      deck that pin belongs to can never be rebuilt once the new file is
      taken in its place. The pins settled before the refusal stay settled.
    """
    done: dict[str, str] = {}
    for name in names:
        pinned = pins.get(name)
        if present(name, raw):
            if pinned is None:
                pins[name] = head(name, http)
                done[name] = "pinned"
            elif accept and moved(pinned, head(name, http)):
                pins[name] = download(name, http, raw, log)
                done[name] = "replaced"
            else:
                done[name] = "kept"
            continue
        why = moved(pinned, head(name, http))
        if why and not accept:
            raise SourceMoved(
                f"{name}: the upstream file is not the one the recipe was made from "
                f"({why}); run with --accept-sources to take it and re-pin")
        pins[name] = download(name, http, raw, log)
        done[name] = "replaced" if why else "fetched"
    return done


def describe(name: str, pins: dict[str, dict], raw: Path = RAW) -> str:
    """One line on a source, for a report: on disk or not, pinned or not."""
    where = "on disk" if present(name, raw) else "not on disk"
    pin = pins.get(name)
    if pin is None:
        return f"{name}: {where}, not pinned"
    size = f"{pin['bytes'] / 1e6:.0f} MB" if pin.get("bytes") else "size unknown"
    return f"{name}: {where}, pinned ({size}, {pin.get('lastModified') or 'no date'})"
