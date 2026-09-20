"""What is committed is what the recipe says: the shipped tree, checked.

The catalogue, the clips and the recipe are all in version control, and
this test reads the real ones rather than a fixture. It is the check that
would have caught #61 — a catalogue committed naming 234 recordings that
existed only on the maintainer's disk — and it fails the same way for a
catalogue committed without the recipe that made it.
"""
import json
from pathlib import Path

import pytest

from frcog.audio import usable
from frcog.config import APP_DIR, MEDIA, RECIPE_PATH
from frcog.recipe import Recipe, catalogue_hash

CATALOGUE = APP_DIR / "static" / "catalogue"


def shipped_words() -> list[dict]:
    files = sorted(CATALOGUE.glob("level-*.json")) + [CATALOGUE / "function.json"]
    return [w for f in files for w in json.loads(f.read_text(encoding="utf-8"))["words"]]


@pytest.mark.skipif(not (CATALOGUE / "meta.json").exists(), reason="no catalogue in this checkout")
def test_every_recording_the_shipped_catalogue_names_is_in_the_media_directory():
    """A card whose recording 404s tells the learner its sound could not be
    fetched, every sitting, for every one of those words (#61)."""
    named = {w[key]: w["k"] for w in shipped_words() for key in ("audio", "native", "cue_audio")
             if w.get(key)}
    missing = sorted(f"{name} ({k})" for name, k in named.items() if not usable(MEDIA / name))
    assert not missing, f"{len(missing)} recordings named and not shipped: {missing[:10]}"


@pytest.mark.skipif(not RECIPE_PATH.exists(), reason="no recipe in this checkout")
def test_the_shipped_catalogue_was_made_by_the_recorded_recipe():
    """`meta.json` says which recipe exported it; `data/recipe.json` says
    which recipe the tree is at. They are committed together or not at all."""
    meta = json.loads((CATALOGUE / "meta.json").read_text(encoding="utf-8"))
    stages = Recipe.load(RECIPE_PATH).stages
    assert set(stages) >= {"build", "audio", "english", "export"}, "every stage recorded"
    assert meta["recipe"] == catalogue_hash(stages), "the catalogue is not the recipe's"
