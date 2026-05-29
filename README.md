# InternAgents

InternAgents is a local DeepAgent workspace with a bundled web UI. It runs a
DeepAgent graph through the LangGraph local API and lets the browser UI connect
directly to that API.

```text
Browser: InternAgents UI at http://127.0.0.1:3000
  -> LangGraph API at http://127.0.0.1:2024
  -> agent.py:agent
  -> create_deep_agent(...)
  -> LocalShellBackend rooted at this repository
```

The repository includes:

- `agent.py`: exports the LangGraph graph named `agent`
- `main.py`: command-line smoke test that reuses the same graph
- `deepagent.config.json`: backend, system prompt, and optional interrupt config
- `langgraph.json`: graph registration for `langgraph dev`
- `ui/`: InternAgents Next.js web UI
- `scripts/dev.sh`: one-command local development launcher

## Current UI Direction

The web UI is moving toward a three-panel local research workspace:

- left panel: `工作区` file tree on top and `会话` history below
- middle panel: the existing agent chat experience
- right panel: a file viewer that previews selected Markdown, text, and PDF
  files from the local workspace

The file tree and viewer are intentionally separate from the chat components so
the agent interaction flow can keep evolving independently from workspace
navigation.

## Quick Start

From the repository root:

```bash
cp .env.example .env
./scripts/dev.sh
```

The script creates `.venv` when needed, installs the Python project, installs UI
dependencies when missing, starts both local services, waits for health checks,
and opens:

```text
http://127.0.0.1:3000/?assistantId=agent
```

If a healthy backend or frontend is already running on the default ports, the
script reuses it instead of starting a duplicate. Press `Ctrl+C` to stop only
the processes started by this script.

Runtime logs are written to:

```text
.internagents/logs/backend.log
.internagents/logs/ui.log
```

Useful overrides:

```bash
INTERNAGENTS_BACKEND_PORT=2025 INTERNAGENTS_UI_PORT=3001 ./scripts/dev.sh
INTERNAGENTS_OPEN_BROWSER=0 ./scripts/dev.sh
INTERNAGENTS_SKIP_INSTALL=1 ./scripts/dev.sh
```

## Model Configuration

The agent reads model and credential settings from the project-local `.env`
file, or from process environment variables supplied by a packaged desktop
launcher:

```env
OPENROUTER_API_KEY=
DEEPAGENT_MODEL=
```

Set `DEEPAGENT_MODEL` to override the model explicitly:

```env
DEEPAGENT_MODEL=openrouter:deepseek/deepseek-v4-flash
```

If `DEEPAGENT_MODEL` is empty, InternAgents falls back to
`LLM_PROVIDER=openrouter` plus `LLM_MODEL`, and finally to
`openrouter:openrouter/auto`. Real keys should stay in an untracked `.env` or in
the desktop app's Application Support runtime directory; they should not be
committed.

## DeepAgent Configuration

Runtime settings for `create_deep_agent(...)` live in:

```text
deepagent.config.json
```

The current config uses `LocalShellBackend` and roots shell/file access at this
repository:

```json
{
  "backend": {
    "type": "local_shell",
    "root_dir": ".",
    "inherit_env": true,
    "virtual_mode": false
  },
  "system_prompt": "..."
}
```

`agent.py` passes `interrupt_on` to `create_deep_agent(...)` only when the
config defines it. To require approval before local shell execution while
leaving `task`, `write_file`, and `edit_file` unintercepted, add:

```json
{
  "interrupt_on": {
    "execute": {
      "allowed_decisions": ["approve", "reject"],
      "description": "Approve this local shell command before it runs."
    }
  }
}
```

`root_dir` may be absolute or relative to the repository root.

## Web UI Configuration

The UI auto-connects to the local backend. There is no manual deployment config
screen in the current InternAgents fork.

Local UI settings live in:

```text
ui/deepagent-ui.config.json
```

Default values:

```json
{
  "deploymentUrl": "http://127.0.0.1:2024",
  "assistantId": "agent",
  "langsmithApiKey": "",
  "stream": {
    "modes": ["messages-tuple", "updates", "values"],
    "subgraphs": true
  }
}
```

The launcher also injects these environment overrides for the dev server:

```text
NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID
NEXT_PUBLIC_LANGSMITH_API_KEY
```

The browser talks to the LangGraph API through the LangGraph JavaScript SDK. It
does not call a Python `RemoteAgent`, and it does not require LangSmith for
local development.

### Tool Display Names

Backend tool names stay unchanged because LangGraph still needs the original
names for tool-call matching, interrupt review, and resume payloads. The Web UI
maps common tool names to Chinese labels only at render time.

The display mapping lives in:

```text
ui/src/app/utils/toolDisplayNames.ts
```

Current examples:

```text
general-purpose -> 通用科研助手
execute -> 执行命令
write_todos / writetodo / writeTodo -> 更新待办
task -> 调用子助手
read_file / write_file / edit_file -> 读取文件 / 写入文件 / 编辑文件
ls / glob / grep -> 查看目录 / 搜索文件 / 搜索文本
```

### Goal Mode

InternAgents includes a lightweight Codex-style goal mode. When the user sends
`/goal <objective>` or explicitly asks to create a persistent goal, the agent can
call `create_goal`. Active goals are stored in the LangGraph thread state,
surfaced in the chat UI, and injected into subsequent model calls so the agent
continues pursuing the same objective across turns. The agent can inspect the
current goal with `get_goal` and mark it `complete` or `blocked` with
`update_goal` after verification.

## Manual Backend Startup

Use this fallback when debugging the LangGraph server directly:

```bash
source .venv/bin/activate
python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --config langgraph.json

cd ui
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Health and API docs:

- <http://127.0.0.1:2024/ok>
- <http://127.0.0.1:2024/docs>

## Manual UI Startup

Use this fallback when debugging only the frontend:

```bash
cd ui
npm install --legacy-peer-deps --ignore-scripts
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open:

```text
http://127.0.0.1:3000/?assistantId=agent
```

## macOS Desktop Packaging

The desktop packaging entrypoint lives in `desktop/`. It builds the Next.js UI
as a standalone server, copies an InternAgents runtime template, bundles a
Python runtime, and asks `electron-builder` to produce an Apple Silicon DMG.

```bash
cd desktop
npm install
npm run build
```

By default `desktop/scripts/prepare-dist.mjs` copies `.conda` as the bundled
Python runtime, falling back to `.venv`. To use a prepared portable runtime,
set:

```bash
INTERNAGENTS_PYTHON_RUNTIME_SOURCE=/path/to/python-runtime npm run build
```

The packaged app writes real user configuration under macOS Application Support
and starts the UI with:

```text
INTERNAGENTS_APP_ROOT=<Application Support>/InternAgents/runtime
INTERNAGENTS_DESKTOP=1
NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:<dynamic-port>
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent_local
```

First launch opens the configuration onboarding flow when the app runtime has no
OpenRouter API key yet.

## Smoke Tests

CLI smoke test:

```bash
python3 main.py "你好，介绍一下你能做什么。"
```

Browser prompts:

```text
你好，介绍一下你能做什么。
```

```text
请列出当前项目根目录有哪些文件。
```

If `interrupt_on.execute` is enabled, the second prompt should show a tool
approval before the local shell command runs.

## Research KB Infra

This repository also contains a prototype Git-native research knowledge-base CLI
under `kb_infra/`.

- KB README: `kb_infra/README.md`
- Agent bootstrap entrypoint: `kb_infra/docs/kb_bootstrap.md`
- Local CLI install from `kb_infra/`: `npm install && npm link`

## Multi-Resource InternAgents Sessions

InternAgents exposes one coordinator LangGraph server plus one agent runtime per
resource. The coordinator is the frontend-facing projection layer; agent work is
executed by the selected runtime over the LangGraph API. SSH is used only for
deployment, tunnels, and workspace projection.
The default resource config is in:

```text
internagent.resources.json
```

The committed default only contains the current machine. Per-machine resources
such as private clusters, cloud hosts, usernames, IPs, SSH aliases, and tunnel
ports should live in an untracked local file, for example:

```bash
cp internagent.resources.example.json internagent.resources.local.json
echo 'INTERNAGENT_RESOURCES_FILE=internagent.resources.local.json' >> .env
```

The local workspace folder is configurable. Open the UI configuration page and
set `工作区 -> 本机工作区路径`; InternAgents writes that value to the
untracked `internagent.resources.local.json` file and points `.env` at it. Local
workspace changes hot-switch for the file browser and subsequent agent
filesystem/shell tool calls; model, API key, and authorization changes still
need the backend to be applied.

The workbench also has a workspace selector. Selecting a workspace resets the
active `threadId`, filters the conversation list to threads whose metadata
matches that workspace, and attaches `internagents_workspace_*` metadata to new
runs. Local runtimes resolve filesystem and shell tools from that run metadata,
so a conversation created under one workspace keeps operating inside that
workspace. The folder button next to the workspace selector opens the local
folder picker, remembers the previous active workspace, and adds the selected
folder as the active workspace.

You can also edit the local resources file directly:

```json
{
  "default_resource": "local",
  "default_workspace": "local-xxxxxxxxxxxx",
  "workspaces": [
    {
      "id": "local-xxxxxxxxxxxx",
      "label": "your-project",
      "path": "/absolute/path/to/your/project"
    }
  ],
  "resources": [
    {
      "id": "local",
      "label": "Current Machine",
      "backend": "local_shell",
      "workspace": "/absolute/path/to/your/project",
      "remote_url": "http://127.0.0.1:22024",
      "remote_assistant_id": "agent",
      "enabled": true
    }
  ]
}
```

Each enabled resource maps to a graph named `agent_<resource-id>`. The committed
config exposes:

- `agent_local` through the local runtime at `http://127.0.0.1:22024`

`langgraph.json` also registers generic remote slots (`agent_remote1`,
`agent_remote2`) so a local resource file can add private remote runtimes without
committing machine-specific details.

The web UI reads matching resource labels and assistant IDs from:

```text
ui/deepagent-ui.config.json
```

For browser-visible private resources during local UI development, set
`NEXT_PUBLIC_INTERNAGENT_RESOURCES` in `ui/.env.local` instead of committing
host-specific labels:

```bash
NEXT_PUBLIC_INTERNAGENT_RESOURCES='[{"id":"local","label":"Current Machine","assistantId":"agent_local"},{"id":"remote1","label":"Remote Runtime","assistantId":"agent_remote1"}]'
NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID=local
```

Packaged desktop builds do not read a user-authored `ui/.env.local`; the
desktop launcher injects browser-visible connection and resource settings when
it starts the Next.js standalone server.

For local development, `scripts/dev.sh` starts the local runtime, the
coordinator, and the UI:

```bash
./scripts/dev.sh
```

The equivalent manual commands are:

```bash
source .venv/bin/activate

INTERNAGENT_PROCESS_ROLE=runtime \
INTERNAGENT_RUNTIME_ID=local \
python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 22024 \
  --no-browser \
  --config langgraph.runtime.json

python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --config langgraph.json
```

Remote resources follow the same runtime pattern: start `langgraph.runtime.json`
on the remote machine with `INTERNAGENT_PROCESS_ROLE=runtime` and the matching
`INTERNAGENT_RUNTIME_ID`, then expose it to the coordinator through an existing
SSH tunnel. Store the concrete SSH command, workspace, and tunnel URL only in
local config. Do not change server network, firewall, SSH daemon,
security-group, or routing settings for this setup; if a runtime is not
reachable with existing access, fix the local resource config, credentials,
process, or tunnel instead.

If a resource sets `kb_path`, InternAgents will best-effort run `kb sync pull`
before each agent run and `kb sync push` after the run using that resource's
backend.
