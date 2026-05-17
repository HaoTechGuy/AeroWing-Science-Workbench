# Research KB Client

This repository contains a prototype `kb` client for Git-native, agent-friendly research knowledge bases.

The main idea: a knowledge repository is just a Git repo with a `kb.yaml` file. The `kb` client provides stable JSON commands for setup, retrieval, configurable domain records, and collaboration workflows. Domain concepts such as experiments, seminars, literature notes, or proposals are configured in `kb.yaml`; they are not hardcoded CLI commands.


## Local Installation

Use directly from the checkout:

```bash
./bin/kb --help
```

Install as a local npm-linked CLI:

```bash
npm install
npm link
kb --help
```

Or install this checkout globally:

```bash
npm install -g .
kb --help
```

The current prototype is an npm wrapper around the Python implementation in `tools/kb/kb_cli.py`. Runtime requirements:

- Node/npm for local CLI linking.
- `python3` on `PATH`.
- Python package `PyYAML`.

Check the local runtime:

```bash
npm run check
```

Run smoke tests:

```bash
npm run smoke
```


## Quick Start (AI Agent)

If you are an AI agent, first inspect the agent-facing guide and command schema:

```bash
cat docs/kb-agent-guide.md
kb --help
kb schema --json
kb doctor --skip-kb --json
```

When the user says they want to use kb, start with:

```bash
kb bootstrap --json
```

If `kb bootstrap` returns `needs_repo_url`, ask the user to create/provide a private Git repository URL, or offer local-only initialization.

Bootstrap a KB repo from a Git URL:

```bash
kb bootstrap --repo <PRIVATE_GIT_URL> --path .research-kb --json
kb attach --repo <PRIVATE_GIT_URL> --path .research-kb --clone --init-if-missing --json
kb config validate --json
kb domain list --json
```

Before writing records, discover the configured domain contract:

```bash
kb domain schema <domain> --json
```

Then append through the generic domain API:

```bash
kb domain append --domain <domain> --field key=value --json
```

Before remote synchronization:

```bash
kb sync status --fetch --json
kb sync push --dry-run --json
```

Agent rules:

- Always use `--json` for parseable commands.
- Use `kb domain list/schema`; do not guess team-specific paths or fields.
- Do not store credentials in prompts, `kb.yaml`, or attachment files.
- Do not edit `kb.yaml` unless asked to configure domains.
- Inspect `error.code` and `suggested_commands` on failure.

## Quick Start

Create a local KB:

```bash
./bin/kb init --path .research-kb --json
./bin/kb attach --path .research-kb --json
./bin/kb config validate --json
./bin/kb domain list --json
```

Attach an existing private Git KB repo:

```bash
./bin/kb attach \
  --repo git@github.com:YOUR_ORG/YOUR_PRIVATE_KB.git \
  --path .research-kb \
  --clone \
  --init-if-missing \
  --json

./bin/kb config validate --json
./bin/kb domain list --json
```

`--clone` clones the Git repo when `.research-kb` does not already exist. `--init-if-missing` creates a default `kb.yaml` and domain directories when the cloned repo has no KB config yet. It does not commit or push anything.

## Agent Bootstrap Prompt

You can give another machine's agent this repository README plus your private KB Git URL and ask:

```text
Use the kb client in this repository.
My knowledge-base Git repo is git@github.com:YOUR_ORG/YOUR_PRIVATE_KB.git.
Attach it to the current project at .research-kb.
If it has no kb.yaml, initialize the default config.
Validate the config and show the available domains.
Do not commit or push without asking.
```

The agent should run:

```bash
./bin/kb attach --repo git@github.com:YOUR_ORG/YOUR_PRIVATE_KB.git --path .research-kb --clone --init-if-missing --json
./bin/kb config validate --json
./bin/kb domain list --json
```

## Domain-Driven Records

`kb.yaml` defines domains:

```yaml
version: 1
repo:
  kind: team-kb
  default_branch: main

domains:
  experiments:
    root: experiments/
    description: Experiment progress and run notes
    path_template: "{project}/{date}-{slug}.md"
    required_fields: [project, title, status]
    optional_fields: [tags, external_assets, next_action]
    frontmatter:
      type: experiment_progress
  ideas:
    root: ideas/
    description: Free-form research ideas
    path_template: "{slug}.md"
    required_fields: [title]
    frontmatter:
      type: idea

collaboration:
  branch_prefix: changes/
  require_human_review: false
```

Append records through the generic domain interface:

```bash
./bin/kb domain append \
  --domain experiments \
  --field project=diffusion-agent \
  --field title="lr sweep batch 3" \
  --field status=running \
  --json
```

Discover and inspect domains:

```bash
./bin/kb domain list --json
./bin/kb domain schema experiments --json
./bin/kb domain list-records --domain experiments --json
```

## Retrieval

Use bounded JSON retrieval so agents do not flood context:

```bash
./bin/kb tree --domain experiments --max-depth 3 --limit 200 --json
./bin/kb grep slurm --domain handbook --context 2 --limit 10 --json
./bin/kb read handbook/compute/slurm.md --range 1:120 --json
```

## Sync

Inspect and synchronize the attached KB Git repo:

```bash
kb sync status --fetch --json
kb sync pull --fetch --json
kb sync push --dry-run --json
```

Safety defaults:

- `sync pull` uses `git pull --ff-only`.
- `sync pull` and `sync push` refuse dirty worktrees unless `--allow-dirty` is set.
- `sync push --dry-run` reports state without changing refs.

For change branches created under `collaboration.branch_prefix`, the expected flow is: create/commit a change branch, run `kb sync push --dry-run`, then run `kb sync push` when safe.

## Current Prototype Scope

Implemented:

- `kb init`
- `kb attach` with optional `--clone` and `--init-if-missing`
- `kb status`
- `kb bootstrap`
- `kb schema`
- `kb doctor`
- `kb config get/validate`
- `kb domain list/schema/append/list-records`
- `kb tree/grep/read`
- `kb sync status/pull/push`

Planned next:

- `kb change create --dry-run`
- `kb change create`
- hosted PR/MR adapter
- MCP wrapper over the same core commands
