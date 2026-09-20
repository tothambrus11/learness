"""What each generated thing is made from: `data/recipe.json`.

The database, the clips and the catalogue are committed, and they are made
by code, from dumps, with packages, all of which change. The recipe is the
record of which: the pin on every upstream dump (`sources.py`) and, for each
stage of the pipeline, a fingerprint of everything that decides its output.
Compare the recipe on disk with what the checkout would make today and the
answer to "does this need regenerating?" is a diff rather than a guess —
which is what let a catalogue be committed without the clips it named (#61).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .config import RECIPE_PATH


@dataclass
class Recipe:
    """The file, read into memory: the pins by source name, and each stage's
    record by stage name. Either is empty on a checkout that never ran
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
