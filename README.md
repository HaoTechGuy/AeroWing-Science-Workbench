# InternAgents

This project exposes a local DeepAgent as a LangGraph API and ships a local
InternAgents web UI in `ui/`.

The local graph includes:

- local filesystem tools
- local shell execution through `LocalShellBackend`
- human approval interrupts configured in `deepagent.config.json`

## Python Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
cp .env.example .env
```

By default, the agent reuses the OpenRouter settings from DiscoveryOS:

```text
/Users/qszhang/Documents/codex/DiscoveryOS/.env.local
```

You can override them in this project's `.env`:

```env
OPENROUTER_API_KEY=
DEEPAGENT_MODEL="openrouter:deepseek/deepseek-v4-flash"
DISCOVERYOS_ENV_FILE="/Users/qszhang/Documents/codex/DiscoveryOS/.env.local"
```

If `DEEPAGENT_MODEL` is empty, the agent follows DiscoveryOS
`LLM_PROVIDER=openrouter` and `LLM_MODEL`.

## DeepAgent Config

Runtime settings for `create_deep_agent(...)` live in:

```text
deepagent.config.json
```

The current config uses `LocalShellBackend`, keeps the `execute` tool available,
and only interrupts before shell execution:

```json
{
  "backend": {
    "type": "local_shell",
    "root_dir": ".",
    "inherit_env": true,
    "virtual_mode": false
  },
  "interrupt_on": {
    "execute": {
      "allowed_decisions": ["approve", "reject"],
      "description": "Approve this local shell command before it runs."
    }
  }
}
```

`write_file`, `edit_file`, and `task` are not listed in `interrupt_on`, so they
will not show approval cards by default. The built-in DeepAgents middleware
stack is still assembled by `create_deep_agent(...)`.

## Terminal 1: Start the Local DeepAgent API

```bash
cd /Users/qszhang/Documents/codex/deepagent
source .venv/bin/activate
python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --config langgraph.json
```

The LangGraph API should be available at:

- <http://127.0.0.1:2024/ok>
- <http://127.0.0.1:2024/docs>

## Terminal 2: Start InternAgents UI

```bash
cd /Users/qszhang/Documents/codex/deepagent/ui
npm install --legacy-peer-deps --ignore-scripts
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open <http://127.0.0.1:3000>. The UI reads its local backend settings from:

```text
ui/deepagent-ui.config.json
```

The default values are:

```json
{
  "deploymentUrl": "http://127.0.0.1:2024",
  "assistantId": "agent",
  "langsmithApiKey": ""
}
```

## Smoke Test

```bash
python3 main.py "你好，介绍一下你能做什么。"
```

The command-line smoke test reuses the same `agent` exported from `agent.py` as
the LangGraph UI server.

## UI Test Prompts

Try these in the browser UI:

```text
你好，介绍一下你能做什么。
```

```text
请列出当前项目根目录有哪些文件。
```

The last prompt should trigger a tool approval before the local shell command
runs.

---

## Research KB Client

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
