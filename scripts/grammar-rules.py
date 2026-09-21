"""Regenerate app/src/lib/grammar/rules.ts from GRAMMAR.md's tables.

The document is where a rule is described; the registry is the same rows as
data, and tests/grammar-rules.test.ts fails when the two disagree. Run this
after editing a table in GRAMMAR.md:

    python scripts/grammar-rules.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "GRAMMAR.md"
OUT = ROOT / "app" / "src" / "lib" / "grammar" / "rules.ts"
MODULES = {"P": "sounds", "N": "numbers", "D": "nouns", "J": "adjectives", "R": "pronouns",
           "V": "verbs", "G": "negation", "Q": "questions", "C": "connectors", "S": "sentences"}
FACES = ["read", "choose", "gap", "which", "say", "hear", "transform", "order", "mark", "spell"]
ROW = re.compile(r"^\| ([A-Z]\.[\w-]+) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$", re.M)


def rules() -> list[dict]:
    out = []
    for m in ROW.finditer(DOC.read_text()):
        rid, what, needs, faces, placed = m.groups()
        after = re.findall(r"· after ([A-Z]\.[\w-]+)", what)
        what = re.sub(r"\s*· after [A-Z]\.[\w-]+", "", what).strip()
        needs = [n.strip() for n in needs.split(",") if n.strip() and n.strip() != "—"]
        faces = [f.strip() for f in faces.split(",") if f.strip()]
        for f in faces:
            if f not in FACES:
                raise SystemExit(f"{rid}: {f!r} is not a face")
        out.append(dict(id=rid, module=MODULES[rid[0]], what=what, needs=needs, after=after,
                        faces=faces, placed=placed.strip()))
    ids = {r["id"] for r in out}
    for r in out:
        for n in r["needs"] + r["after"]:
            if n not in ids:
                raise SystemExit(f"{r['id']} names {n}, which is not a rule")
    return out


def main() -> None:
    text = OUT.read_text()
    head = text[:text.index("export const RULES = {")]
    tail = text[text.index("} as const satisfies Record<string, RuleSpec>;"):]
    s = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731
    rows = []
    for r in rules():
        rows.append(f"  {s(r['id'])}: {{\n    module: {s(r['module'])},\n    what: {s(r['what'])},\n"
                    f"    needs: [{', '.join(s(n) for n in r['needs'])}],\n"
                    f"    after: [{', '.join(s(n) for n in r['after'])}],\n"
                    f"    faces: [{', '.join(s(f) for f in r['faces'])}],\n"
                    f"    placed: {s(r['placed'])},\n  }},")
    OUT.write_text(head + "export const RULES = {\n" + "\n".join(rows) + "\n" + tail)
    print(f"{len(rows)} rules -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
