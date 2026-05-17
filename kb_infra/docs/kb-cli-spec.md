# `kb` CLI Contract Specification

> Status: Draft 0.2  
> Scope: MVP local Git knowledge repository commands.  
> Parent PRD: `research-agent-collab-prd.md`

## 1. Contract Goals

`kb` is a configurable knowledge client. It exposes stable primitives for repository setup, bounded retrieval, domain-driven record creation, and Git changes.

The CLI must not hardcode domain semantics such as "experiment" or "proposal" as first-class top-level product concepts. Those are configuration-defined domains or collaboration workflows layered on top of generic primitives.

## 2. Global Conventions

### 2.1 Output Streams

| Stream | Content |
|---|---|
| stdout | Command result. Must be JSON when `--json` is set. |
| stderr | Logs, warnings, progress messages, debug output. |

No command may print progress bars, prompts, or prose to stdout when `--json` is set.

### 2.2 Global Flags

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON. |
| `--table` | Emit human table where supported. Mutually exclusive with `--json`. |
| `--compact` | Minimize JSON fields and snippets for token efficiency. |
| `--limit <n>` | Limit list/search result count. |
| `--range <start:end>` | Limit file reads by 1-based inclusive line range. |
| `--domain <name>` | Scope operation to one configured domain where supported. |
| `--cwd <path>` | Resolve project and KB attachment from another working directory. |
| `--kb-path <path>` | Explicit KB path override. |
| `--dry-run` | Report intended mutation without applying it. |
| `--no-color` | Disable ANSI color in human output. |

### 2.3 Exit Codes

| Code | Meaning |
|---:|---|
| 0 | Success. |
| 1 | Generic command failure. |
| 2 | Invalid CLI arguments. |
| 3 | KB repo not found or not attached. |
| 4 | Config invalid. |
| 5 | Git operation failed. |
| 6 | Policy or safety guard blocked operation. |
| 7 | Requested path is outside allowed KB roots. |
| 8 | Result too large without an explicit bound. |
| 9 | Domain not found or domain field validation failed. |
| 10 | External integration failed. Reserved for post-MVP forge/MCP use. |

### 2.4 Error Shape

All JSON errors use this envelope:

```json
{
  "ok": false,
  "error": {
    "code": "KB_REPO_NOT_FOUND",
    "message": "No knowledge repository found in current directory.",
    "details": {},
    "suggested_commands": ["kb init", "kb attach --path .research-kb"]
  }
}
```

Rules:

- `error.code` is stable and uppercase snake case.
- `message` is human-readable and not used for program logic.
- `details` is an object, never a string.
- `suggested_commands` must not include destructive commands.

## 3. Common JSON Envelope

Successful JSON commands should use:

```json
{
  "ok": true,
  "command": "kb status",
  "repo": {
    "path": "/abs/path/.research-kb",
    "branch": "main",
    "head": "abc1234",
    "default_branch": "main"
  },
  "data": {},
  "warnings": [],
  "truncated": false
}
```

Field rules:

- `ok` is always present.
- `command` is the normalized command name, not the full shell string.
- `repo` is present for commands that operate on a KB.
- `warnings` is always an array.
- `truncated` is true whenever the result was shortened by limits, range, or compact mode.

## 4. Config File: `kb.yaml`

Minimum valid MVP config:

```yaml
version: 1
repo:
  kind: team-kb
  default_branch: main

domains:
  handbook:
    root: handbook/
    description: Team handbook and operational docs
    path_template: "{slug}.md"
    required_fields: [title]
    optional_fields: [tags]
    frontmatter:
      type: handbook
  experiments:
    root: experiments/
    description: Experiment progress and run notes
    path_template: "{project}/{date}-{slug}.md"
    required_fields: [project, title, status]
    optional_fields: [tags, external_assets, next_action]
    frontmatter:
      type: experiment_progress

search:
  include:
    - "**/*.md"
    - "**/*.qmd"
    - "**/*.tex"
    - "**/*.yaml"
    - "**/*.yml"
    - "**/*.bib"
  exclude:
    - ".git/**"
    - "node_modules/**"
    - ".venv/**"

collaboration:
  branch_prefix: changes/
  require_human_review: false
```

### 4.1 Domain Schema

Each domain supports:

| Field | Required | Meaning |
|---|---|---|
| `root` | yes | Directory root inside the KB. |
| `description` | no | Agent-readable explanation. |
| `path_template` | yes for append | Relative path under `root`; may use `{date}`, `{slug}`, and provided fields. |
| `required_fields` | no | Fields required by `kb domain append`. |
| `optional_fields` | no | Fields accepted but not required. |
| `frontmatter` | no | Default frontmatter merged into generated Markdown. |
| `template` | no | Optional template file path for body generation. |

Validation levels:

| Level | Meaning |
|---|---|
| error | Command cannot safely continue. |
| warning | Command can continue but behavior may be degraded. |
| info | Non-blocking recommendation. |

## 5. Path and Safety Rules

- Paths are resolved relative to the KB root unless absolute paths are explicitly accepted by a command.
- `--domain <name>` scopes reads/searches/writes to the configured domain root.
- Write commands must reject writes outside configured domain roots.
- Git metadata paths such as `.git/**` are not readable by default.
- Default branch mutation is blocked for change creation.
- `--dry-run` must not create branches, commits, or KB content files.

## 6. MVP Commands

### 6.1 `kb init`

Creates a new KB repository with a domain-based `kb.yaml`.

Example:

```bash
kb init --path .research-kb --kind team-kb --json
```

Success data:

```json
{
  "created": ["kb.yaml", "handbook/", "projects/", "experiments/", "seminars/"],
  "git_initialized": true,
  "next_commands": ["kb status --json"]
}
```

### 6.2 `kb attach`

Records how a project attaches to a KB.

Example:

```bash
kb attach --path .research-kb --mode ignored-subrepo --repo git@example.com:team/kb.git --json
```

Bootstrap from a Git URL:

```bash
kb attach --repo git@example.com:team/kb.git --path .research-kb --clone --init-if-missing --json
```

MVP implementation may only support `ignored-subrepo`, but unsupported modes must fail with `UNSUPPORTED_ATTACH_MODE`.

Rules:

- `--clone` requires `--repo`.
- `--clone` clones only when the target path is missing or empty.
- Existing non-empty paths must already be a Git repo or valid KB path.
- `--init-if-missing` creates default `kb.yaml` and domain directories when no config exists.
- The command writes attachment metadata but does not commit, push, or store credentials.

### 6.3 `kb status`

Reports KB repo and config state.

Example data:

```json
{
  "clean": false,
  "branch": "changes/alice/slurm-note",
  "head": "abc1234",
  "default_branch": "main",
  "untracked_count": 2,
  "modified_count": 1,
  "config_valid": true,
  "attachment": {
    "mode": "ignored-subrepo",
    "path": ".research-kb"
  }
}
```

### 6.4 `kb config get`

Returns effective config.

Example:

```bash
kb config get --json
```

### 6.5 `kb config validate`

Validates `kb.yaml` and returns diagnostics.

Example data:

```json
{
  "valid": true,
  "diagnostics": []
}
```

### 6.6 `kb domain list`

Lists configured domains.

Example:

```bash
kb domain list --json
```

Data shape:

```json
{
  "domains": [
    {
      "name": "experiments",
      "root": "experiments/",
      "description": "Experiment progress and run notes",
      "required_fields": ["project", "title", "status"]
    }
  ]
}
```

### 6.7 `kb domain schema`

Returns one domain's schema.

Example:

```bash
kb domain schema experiments --json
```

Data shape:

```json
{
  "name": "experiments",
  "schema": {
    "root": "experiments/",
    "path_template": "{project}/{date}-{slug}.md",
    "required_fields": ["project", "title", "status"],
    "optional_fields": ["tags", "external_assets", "next_action"],
    "frontmatter": {"type": "experiment_progress"}
  }
}
```

### 6.8 `kb tree`

Returns a bounded tree view, optionally scoped to a domain.

Example:

```bash
kb tree --domain experiments --max-depth 3 --limit 200 --json
```

Data shape:

```json
{
  "root": "experiments",
  "domain": "experiments",
  "max_depth": 3,
  "entries": [
    {"path": "experiments/diffusion-agent", "kind": "dir"},
    {"path": "experiments/diffusion-agent/2026-05-16-lr-sweep.md", "kind": "file", "bytes": 4312}
  ],
  "omitted_count": 0
}
```

### 6.9 `kb grep`

Searches text files using configured include/exclude globs, optionally scoped to a domain.

Example:

```bash
kb grep "slurm" --domain experiments --context 2 --limit 10 --json
```

Rules:

- Results must include line ranges.
- Snippets must be bounded.
- Binary files are skipped.
- If output would exceed limits, return `truncated: true` and `next_cursor` when pagination exists.

### 6.10 `kb read`

Reads a file or line range.

Example:

```bash
kb read handbook/compute/slurm.md --range 1:120 --json
```

Data shape:

```json
{
  "path": "handbook/compute/slurm.md",
  "line_start": 1,
  "line_end": 120,
  "total_lines": 260,
  "content": "# Slurm\n...",
  "commit": "abc1234"
}
```

### 6.11 `kb domain append`

Creates a Markdown record in a configured domain.

Example:

```bash
kb domain append --domain experiments --field project=diffusion-agent --field title="lr sweep batch 3" --field status=running --json
```

Data shape:

```json
{
  "domain": "experiments",
  "created_path": "experiments/diffusion-agent/2026-05-16-lr-sweep-batch-3.md",
  "frontmatter": {
    "type": "experiment_progress",
    "project": "diffusion-agent",
    "title": "lr sweep batch 3",
    "status": "running"
  },
  "committed": false
}
```

Rules:

- The command creates content but does not commit by default.
- It must use the selected domain's `root` and `path_template`.
- Missing required fields fail with `KB_DOMAIN_FIELD_REQUIRED`.
- Unknown domains fail with `KB_DOMAIN_NOT_FOUND`.
- Existing target paths fail with `PATH_EXISTS` unless a future explicit overwrite flag exists.

### 6.12 `kb domain list-records`

Lists records under a configured domain.

Example:

```bash
kb domain list-records --domain experiments --limit 10 --json
```

Data shape:

```json
{
  "domain": "experiments",
  "records": [
    {
      "path": "experiments/diffusion-agent/2026-05-16-lr-sweep-batch-3.md",
      "frontmatter": {
        "title": "lr sweep batch 3",
        "status": "running"
      }
    }
  ]
}
```

### 6.13 `kb change create`

Creates or previews a change branch and commit from selected paths. This is the generic collaboration primitive formerly described as proposal creation.

Dry-run example:

```bash
kb change create --paths experiments/diffusion-agent/2026-05-16-lr-sweep-batch-3.md --title "Archive lr sweep batch 3" --dry-run --json
```

Data shape:

```json
{
  "dry_run": true,
  "base_branch": "main",
  "change_branch": "changes/alice/archive-lr-sweep-batch-3",
  "files": [
    {
      "path": "experiments/diffusion-agent/2026-05-16-lr-sweep-batch-3.md",
      "change": "add",
      "domain": "experiments"
    }
  ],
  "commit_message": {
    "subject": "Archive lr sweep batch 3",
    "trailers": {
      "Agent-Run-ID": "run_01HX",
      "Session-ID": "thread_abc",
      "Generated-By": "kb-cli"
    }
  },
  "diff_summary": {
    "files_changed": 1,
    "insertions": 42,
    "deletions": 0
  }
}
```

Required guards:

- Refuse to create a change from a dirty unrelated workspace unless files are explicitly selected.
- Refuse to use a branch name outside configured `collaboration.branch_prefix`.
- Refuse direct default-branch commits.
- Include trace trailers when provided through flags or environment.


### 6.14 `kb sync status`

Reports remote URL, current branch, upstream, ahead/behind counts, HEAD, and dirty worktree summary.

Example:

```bash
kb sync status --fetch --json
```

Data shape:

```json
{
  "remote": "origin",
  "remote_url": "git@example.com:team/kb.git",
  "branch": "changes/alice/foo",
  "upstream": "origin/changes/alice/foo",
  "head": "abc1234",
  "ahead": 1,
  "behind": 0,
  "has_commit": true,
  "dirty": {
    "clean": true,
    "untracked_count": 0,
    "modified_count": 0,
    "files": []
  }
}
```

### 6.15 `kb sync pull`

Fast-forward pulls from the configured remote.

Example:

```bash
kb sync pull --fetch --json
```

Rules:

- Uses `git pull --ff-only`.
- Refuses dirty worktrees unless `--allow-dirty` is set.
- `--dry-run` reports before/after preview without changing refs.

### 6.16 `kb sync push`

Pushes the current branch to the configured remote.

Example:

```bash
kb sync push --dry-run --json
kb sync push --json
```

Rules:

- Refuses dirty worktrees unless `--allow-dirty` is set.
- Refuses detached HEAD.
- Uses `git push -u <remote> <branch>`.

## 7. Environment Metadata

Agents and runtime can provide trace metadata through environment variables:

| Variable | Trailer |
|---|---|
| `KB_AGENT_RUN_ID` | `Agent-Run-ID` |
| `KB_SESSION_ID` | `Session-ID` |
| `KB_GENERATED_BY` | `Generated-By` |
| `KB_SOURCE_REFS` | `Source-Refs` |

CLI flags may override environment variables when explicitly set.

## 8. Test Requirements

Every MVP command needs:

- JSON golden output test.
- Error output test.
- Path traversal rejection test where applicable.
- Domain-not-found test for domain-scoped commands.
- Required-field validation test for `kb domain append`.
- `--compact` smoke test for retrieval commands.
- `--dry-run` no-write test for mutation commands.
- Default-branch guard test for `kb change create`.
