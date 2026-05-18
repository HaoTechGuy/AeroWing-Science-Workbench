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

The agent reads `.env` first. The default `.env.example` leaves project-local
OpenRouter values empty so a local DiscoveryOS env file can provide them:

```env
OPENROUTER_API_KEY=
DEEPAGENT_MODEL=
DISCOVERYOS_ENV_FILE=/Users/qszhang/Documents/codex/DiscoveryOS/.env.local
```

Set `DEEPAGENT_MODEL` to override the model explicitly:

```env
DEEPAGENT_MODEL=openrouter:deepseek/deepseek-v4-flash
```

If `DEEPAGENT_MODEL` is empty and `DISCOVERYOS_ENV_FILE` exists, `agent.py`
reuses `LLM_PROVIDER=openrouter`, `LLM_MODEL`, and OpenRouter credentials from
that file. Real keys should stay in `.env` or the DiscoveryOS env file; neither
file should be committed.

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

## Manual Backend Startup

Use this fallback when debugging the LangGraph server directly:

```bash
source .venv/bin/activate
python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --config langgraph.json
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
