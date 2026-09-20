"""`frcog refresh` does what the recipe says is out of date, and no more.

The whole run is driven against a temporary checkout: a seeded database,
dumps on disk that are a few bytes each, a media directory of its own, the
upstreams stood in for, and the voices faked (the ranking itself is stood
in for too, since it needs the real 578 MB extract; every other stage is
the real one). What is checked is the plan — which stages run, which are
left alone, and what the recipe and the catalogue say afterwards.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from catalogue_fixture import seeded
from frcog import audio, english, recipe as recipe_mod, refresh
from frcog.audio import MIN_BYTES
from frcog.config import SOURCES, Config
from frcog.recipe import Recipe
from frcog.refresh import Options, Paths
from test_audio import GoodVoice, _no_sleep
from test_recipe import FakeUpstream


@pytest.fixture()
def world(tmp_path, monkeypatch):
    """A checkout that has never run the refresh: everything on disk, nothing
    recorded. The build stage only records that it ran."""
    monkeypatch.setattr(audio, "MEDIA", tmp_path / "media")
    GoodVoice.asked = []
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=GoodVoice))
    monkeypatch.setattr(audio.asyncio, "sleep", _no_sleep)
    said: list[str] = []

    def fake_say(pipe, text, out, cfg):
        said.append(text)
        out.write_bytes(b"\0" * (MIN_BYTES + 1))
        return None

    monkeypatch.setattr(english, "_pipeline", lambda cfg: object())
    monkeypatch.setattr(english, "_say", fake_say)
    raw = tmp_path / "raw"
    raw.mkdir()
    for src in SOURCES.values():
        (raw / src.file).write_bytes(b"a dump")
    seeded(tmp_path / "test.db").close()
    upstream = FakeUpstream()
    for name in SOURCES:
        upstream.serve(name)
    built: list[Config] = []
    natives: list[int] = []
    runners = {
        **refresh.RUNNERS,
        "build": lambda con, cfg, paths, log: built.append(cfg) or {"words": 6},
        "native": lambda con, cfg, limit, log: natives.append(1) or 0,
    }
    return SimpleNamespace(
        paths=Paths(recipe=tmp_path / "recipe.json", db=tmp_path / "test.db", raw=raw,
                    catalogue=tmp_path / "catalogue"),
        upstream=upstream, runners=runners, built=built, natives=natives, said=said, tmp=tmp_path)


def go(world, cfg: Config | None = None, **flags) -> tuple[int, str]:
    return refresh.run(Options(**flags), cfg or Config(), world.paths, log=lambda *_: None,
                       http=world.upstream, runners=world.runners)


def stages_of(world) -> dict:
    return Recipe.load(world.paths.recipe).stages


def test_check_on_a_fresh_checkout_names_every_stage_and_touches_nothing(world):
    """What a CI job and a curious maintainer read first."""
    code, report = go(world, check=True)
    assert code == 1, "a run would do something"
    for name in ("build", "audio", "english", "export"):
        assert f"- {name}: stale — never recorded" in report
    assert "7 clips to make (7 missing" in report, "the French clips, counted"
    assert "6 clips to make (6 missing" in report, "the cues, counted"
    assert "not pinned" in report
    assert world.upstream.calls == [], "no network"
    assert not world.paths.recipe.exists(), "nothing written"
    assert not world.paths.catalogue.exists()
    assert world.built == []


def test_a_first_run_pins_the_dumps_runs_every_stage_and_records_the_recipe(world):
    code, report = go(world)
    assert code == 0
    assert world.built == [Config()]
    rec = Recipe.load(world.paths.recipe)
    assert set(rec.sources) == set(SOURCES), "every dump pinned"
    assert set(rec.stages) == {"build", "audio", "english", "export"}
    assert [m for m, _ in world.upstream.calls] == ["HEAD"] * 6, "pinned from a HEAD, nothing fetched"
    assert "Sources: 6 pinned" in report
    assert "- audio: 7 made (0 remade), 0 adopted, 0 kept, 0 failed; 7 with a clip" in report
    assert "- english: 6 made" in report
    assert "Ran: build, audio, english, export" in report
    meta = json.loads((world.paths.catalogue / "meta.json").read_text())
    assert meta["recipe"] == recipe_mod.catalogue_hash(rec.stages), (
        "the catalogue says what it was made from")
    assert f"- catalogue: {meta['recipe']}" in report
    assert world.natives == [], "not unless asked"


def test_a_second_run_finds_nothing_to_do_and_touches_nothing(world):
    """The point of the recipe: a regeneration that changed nothing is a
    no-op, byte for byte, so a pull request opened from it is empty."""
    go(world)
    recipe_before = world.paths.recipe.read_bytes()
    catalogue_before = {p.name: p.read_bytes() for p in world.paths.catalogue.iterdir()}
    GoodVoice.asked = []
    world.said.clear()

    code, report = go(world, check=True)
    assert code == 0 and "stale" not in report
    code, report = go(world)
    assert code == 0
    assert "Up to date: nothing to do." in report
    assert world.built == [Config()], "the build did not run again"
    assert GoodVoice.asked == [] and world.said == [], "no clip was made"
    assert world.paths.recipe.read_bytes() == recipe_before
    assert {p.name: p.read_bytes() for p in world.paths.catalogue.iterdir()} == catalogue_before


def test_a_changed_dial_makes_its_stage_stale_and_the_export_follows_it(world):
    go(world)
    GoodVoice.asked = []
    code, report = go(world, Config(top_n=5), check=True)
    assert code == 1
    assert "- build: stale — config: top_n" in report, "why, in a line"
    assert "- export: stale — upstream: build" in report
    assert "- audio: up to date" in report

    code, report = go(world, Config(top_n=5))
    assert code == 0
    assert len(world.built) == 2 and world.built[1].top_n == 5
    assert GoodVoice.asked == [], "the clips are keyed by word and stay"
    assert "- audio: 0 made (0 remade), 0 adopted, 7 kept" in report
    assert "Ran: build, export" in report
    assert stages_of(world)["build"]["config"]["top_n"] == 5


def test_a_new_voice_remakes_the_clips_and_leaves_the_deck_alone(world):
    go(world)
    GoodVoice.asked = []
    code, report = go(world, Config(tts_voice="fr-CH-FabriceNeural"))
    assert code == 0
    assert len(GoodVoice.asked) == 7
    assert len(world.built) == 1, "no re-ranking"
    assert "- audio: 7 made (7 remade)" in report
    assert "Ran: audio, export" in report


def test_a_moved_upstream_stops_the_run_until_it_is_accepted(world):
    """A cache miss in CI after kaikki.org re-exported: the refresh must not
    quietly rank a different Wiktionary."""
    go(world)
    (world.paths.raw / SOURCES["kaikki-fr"].file).unlink()
    world.upstream.serve("kaikki-fr", etag='"v2"', body=b"a newer dump")
    pins_before = Recipe.load(world.paths.recipe).sources
    code, report = go(world)
    assert code == 1
    assert "Refused: kaikki-fr:" in report and '"v2"' in report
    assert Recipe.load(world.paths.recipe).sources == pins_before, "the pin of record stands"
    assert len(world.built) == 1, "nothing rebuilt"

    code, report = go(world, accept_sources=True)
    assert code == 0
    assert (world.paths.raw / SOURCES["kaikki-fr"].file).read_bytes() == b"a newer dump"
    assert Recipe.load(world.paths.recipe).sources["kaikki-fr"]["etag"] == '"v2"'
    assert len(world.built) == 2, "a new extract is a new ranking"
    assert "Sources: 5 kept, 1 replaced" in report


def test_without_kokoro_the_cues_are_left_for_the_next_run_and_the_recipe_says_so(world, monkeypatch):
    def unavailable(cfg):
        raise english.EnglishUnavailable("Kokoro is not installed")
    monkeypatch.setattr(english, "_pipeline", unavailable)
    code, report = go(world)
    assert code == 0, "a deck without cues is still a deck"
    assert "- english: not done (Kokoro is not installed)" in report
    assert "english" not in stages_of(world), "not stamped, so the next run with Kokoro does them"
    assert (world.paths.catalogue / "meta.json").exists(), "the export still ran"
    code, report = go(world, check=True)
    assert code == 1 and "- english: stale — never recorded" in report

    monkeypatch.setattr(english, "_pipeline", lambda cfg: object())
    code, report = go(world)
    assert "- english: 6 made" in report
    assert "english" in stages_of(world)


def test_native_recordings_are_fetched_only_when_asked(world):
    go(world)
    assert world.natives == []
    code, report = go(world, native=True)
    assert world.natives == [1]
    assert "- native:" in report and "Ran: native, export" in report, (
        "a fetch changes what the catalogue names, so the export follows")


def test_a_run_cut_off_after_the_build_records_how_far_it_got(world):
    """Each stage is recorded as it finishes, so the next run picks up from
    the audio rather than ranking again."""
    def broken_audio(con, cfg, recipe, limit, log):
        raise RuntimeError("edge-tts is down")
    world.runners["audio"] = broken_audio
    with pytest.raises(RuntimeError):
        go(world)
    assert set(stages_of(world)) == {"build"}
    world.runners["audio"] = refresh.RUNNERS["audio"]
    code, report = go(world)
    assert len(world.built) == 1, "the build was not run again"
    assert "Ran: audio, english, export" in report


def test_the_report_reads_as_markdown_with_the_recipe_in_it(world):
    _, report = go(world)
    assert report.startswith("## Pipeline refresh\n")
    lines = report.splitlines()
    assert "Recipe:" in lines
    tail = lines[lines.index("Recipe:") + 1:]
    assert [l.split(":")[0] for l in tail] == ["- build", "- audio", "- english", "- export", "- catalogue"]
    assert all(len(l.split(": ")[1]) == 16 for l in tail), tail


def test_a_run_that_could_not_make_a_clip_does_not_pass(world, monkeypatch):
    """The first real run of this command made no French clip at all — a
    proxy the voice would not speak through — and exited 0 with "118 failed"
    in the middle of the report. On CI that is a green job and a pull
    request with 118 words gone quiet: #61 again, by another door. The
    export still leaves the silent words out honestly; the run just does
    not get to call itself done."""
    from test_audio import FakeVoice
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=FakeVoice))
    code, report = go(world)
    assert code == 1
    assert "Not done: 2 clips could not be made" in report
    assert "Ran: build, audio, english, export" in report, "what could be done was done and recorded"
    monkeypatch.setattr(audio, "edge_tts", SimpleNamespace(Communicate=GoodVoice))
    code, report = go(world)
    assert code == 0, "the next run makes the one that was missing"
    assert "audio: 2 made" in report
