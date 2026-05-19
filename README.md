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

## Research KB Infra

This repository also contains a prototype Git-native research knowledge-base CLI under `kb_infra/`.

- KB README: `kb_infra/README.md`
- Agent bootstrap entrypoint: `kb_infra/docs/kb_bootstrap.md`
- Local CLI install from `kb_infra/`: `npm install && npm link`

## Multi-Resource InternAgents Sessions

InternAgents can expose multiple resource-bound assistants from one LangGraph server.
The default resource config is in:

```text
internagent.resources.json
```

Each enabled resource becomes a graph named `agent_<resource-id>`. The current
config exposes:

- `agent_local` for the current machine workspace
- `agent_h` for the H cluster through SSH

The web UI reads matching resource labels and assistant IDs from:

```text
ui/deepagent-ui.config.json
```

Run the server as usual:

```bash
source .venv/bin/activate
python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --config langgraph.json
```

Then run the UI:

```bash
cd ui
npm run dev -- --hostname 127.0.0.1 --port 3000
```

In production on the Volcano host, update `internagent.resources.json` so each
`ssh_command` is executable from the Volcano host. Do not change server network,
firewall, SSH daemon, security-group, or routing settings for this setup; if SSH
is not reachable with existing access, fix the resource config or credentials
instead.

If a resource sets `kb_path`, InternAgents will best-effort run `kb sync pull`
before each agent run and `kb sync push` after the run using that resource's
backend.
