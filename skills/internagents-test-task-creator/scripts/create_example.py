#!/usr/bin/env python3
"""Create numbered InternAgents browser-test example workspaces."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


DEFAULT_ROOT = Path(".internagents") / "test-examples"

TEMPLATES: dict[str, dict[str, str | dict[str, str]]] = {
    "paper": {
        "title": "Multi-document Reading Brief",
        "body": """# {title}

You are preparing a technical discussion and need InternAgents to read the documents in this workspace.

Files:
- docs/agent_notes.md
- docs/tool_use_notes.md
- docs/skill_accumulation_notes.md

Task:
Use InternAgents to compare the documents, identify shared themes and disagreements, and create `reading_brief.md`.

Success criteria:
- The chat response covers every file listed above.
- `reading_brief.md` is visible in the workspace file list and can be previewed.
- The brief includes a comparison table and a short recommendation section.

Restrictions:
- Do not edit the source documents.
- Do not use files outside this workspace.
""",
        "files": {
            "docs/agent_notes.md": "# Agent Notes\n\nAgents combine reasoning, tool use, and memory to complete multi-step tasks.\n",
            "docs/tool_use_notes.md": "# Tool Use Notes\n\nTool use is strongest when calls have clear inputs, observable outputs, and recovery paths.\n",
            "docs/skill_accumulation_notes.md": "# Skill Accumulation Notes\n\nReusable skills help agents preserve task-specific procedures and validation habits.\n",
        },
    },
    "coding": {
        "title": "Toy ML Experiment",
        "body": """# {title}

You are checking whether InternAgents can run code, inspect outputs, and write a concise experiment report.

Files:
- train.py
- data.csv

Task:
Use InternAgents to run the toy experiment, inspect the output metrics, fix any obvious issue if the run fails, and create `experiment_report.md`.

Success criteria:
- The experiment is executed through InternAgents.
- `experiment_report.md` is visible in the workspace file list and can be previewed.
- The report includes the command used, final metric, and whether any code change was needed.

Restrictions:
- Do not use files outside this workspace.
- Keep any code edits minimal and explain them in the report.
""",
        "files": {
            "data.csv": "x,y\n0,0\n1,2\n2,4\n3,6\n4,8\n",
            "train.py": "import csv\n\nxs = []\nys = []\nwith open('data.csv', newline='') as f:\n    for row in csv.DictReader(f):\n        xs.append(float(row['x']))\n        ys.append(float(row['y']))\n\nslope = sum(x * y for x, y in zip(xs, ys)) / sum(x * x for x in xs if x != 0)\nprint(f'slope={slope:.3f}')\nprint('status=ok')\n",
        },
    },
    "skill": {
        "title": "Skill Creation Workflow",
        "body": """# {title}

You are validating whether InternAgents can create a reusable skill from a short brief.

Files:
- brief.md

Task:
Use InternAgents to create a skill folder from `brief.md`, including a valid `SKILL.md`. Then summarize how the skill should be invoked.

Success criteria:
- A new skill folder is visible in the workspace file list.
- The generated `SKILL.md` contains YAML frontmatter with `name` and `description`.
- The chat response names the skill and explains its trigger behavior.

Restrictions:
- Do not install external dependencies.
- Do not use files outside this workspace.
""",
        "files": {
            "brief.md": "# Skill Brief\n\nCreate a skill that helps summarize browser bug reports into concise release-blocker notes. It should mention screenshots, console logs, network failures, and reproduction steps.\n",
        },
    },
    "mixed": {
        "title": "Workspace Analysis And Report",
        "body": """# {title}

You are checking whether InternAgents can browse workspace files, run a small command, and create a final report.

Files:
- README_SOURCE.md
- scripts/check_data.py
- data/items.json

Task:
Use InternAgents to inspect the files, run the data check, and create `workspace_report.md` summarizing the result.

Success criteria:
- The check is run through InternAgents.
- `workspace_report.md` is visible in the workspace file list and can be previewed.
- The report includes what was checked, the command result, and any recommendation.

Restrictions:
- Do not use files outside this workspace.
- Do not change the check script unless it fails for an obvious local reason.
""",
        "files": {
            "README_SOURCE.md": "# Source Notes\n\nThe data file lists items that should each have an id, title, and status.\n",
            "scripts/check_data.py": "import json\nfrom pathlib import Path\n\nitems = json.loads(Path('data/items.json').read_text())\nmissing = [item for item in items if not all(k in item for k in ('id', 'title', 'status'))]\nprint(f'items={len(items)}')\nprint(f'missing_required_fields={len(missing)}')\n",
            "data/items.json": "[\n  {\"id\": 1, \"title\": \"alpha\", \"status\": \"ready\"},\n  {\"id\": 2, \"title\": \"beta\", \"status\": \"review\"}\n]\n",
        },
    },
}


def slugify(value: str) -> str:
    value = value.strip().lower().replace("-", "_")
    value = re.sub(r"[^a-z0-9_]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    if not value:
        raise ValueError("slug must contain at least one letter or digit")
    return value


def next_number(root: Path) -> int:
    highest = 0
    if root.exists():
        for child in root.iterdir():
            if child.is_dir():
                match = re.match(r"^(\d{2})_", child.name)
                if match:
                    highest = max(highest, int(match.group(1)))
    return highest + 1


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def resolve_root(root: str) -> Path:
    path = Path(root)
    if path.is_absolute():
        return path
    return Path.cwd() / path


def create_example(root: Path, kind: str, slug: str, number: int | None, title: str | None, force: bool) -> Path:
    if kind not in TEMPLATES:
        valid = ", ".join(sorted(TEMPLATES))
        raise ValueError(f"unknown kind {kind!r}; expected one of: {valid}")

    root.mkdir(parents=True, exist_ok=True)
    selected_number = number if number is not None else next_number(root)
    example_name = f"{selected_number:02d}_{slugify(slug)}"
    example_dir = root / example_name
    if example_dir.exists() and not force:
        raise FileExistsError(f"{example_dir} already exists; pass --force to overwrite template files")

    template = TEMPLATES[kind]
    final_title = title or str(template["title"])
    body = str(template["body"]).format(title=final_title)
    write_file(example_dir / "README.md", body)
    for relative, content in dict(template["files"]).items():
        write_file(example_dir / relative, str(content))
    return example_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="directory that stores numbered examples")
    parser.add_argument("--kind", choices=sorted(TEMPLATES), required=True, help="template kind")
    parser.add_argument("--slug", required=True, help="short snake-case name after NN_")
    parser.add_argument("--number", type=int, help="explicit example number; defaults to next number")
    parser.add_argument("--title", help="README title")
    parser.add_argument("--force", action="store_true", help="overwrite template files if the example exists")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    example_dir = create_example(
        root=resolve_root(args.root),
        kind=args.kind,
        slug=args.slug,
        number=args.number,
        title=args.title,
        force=args.force,
    )
    print(example_dir)


if __name__ == "__main__":
    main()
