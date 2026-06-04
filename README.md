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

## Guided Tour Update

This branch updates the desktop first-run experience:

- First launch opens the local workbench and redirects to setup only when the
  selected model provider still needs credentials.
- The preferred desktop setup uses 集思: the user enters an email, receives a
  user-scoped virtual key, and the real DeepSeek key stays on the service side.
- A Quickstart tour introduces the workbench, project selector, workspace,
  conversations, service connection, skills, configuration, and About/Updates.
- The About/Updates page can restart the tour and exposes local update actions.
- Workspace file/folder open routes and conversation title helpers support the
  refreshed desktop workflow.
- UI polish is intentionally light: tighter navigation, cleaner panels, and
  more consistent buttons, inputs, selectors, and previews.

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
starts the backend and runtime with 5 worker slots each, and opens:

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
INTERNAGENTS_LANGGRAPH_JOBS_PER_WORKER=8 ./scripts/dev.sh
INTERNAGENTS_OPEN_BROWSER=0 ./scripts/dev.sh
INTERNAGENTS_SKIP_INSTALL=1 ./scripts/dev.sh
```

## Model Configuration

The agent reads model and credential settings from the project-local `.env`
file, or from process environment variables supplied by a packaged desktop
launcher:

```env
INTERNAGENTS_MODEL_PROVIDER=gateway
INTERNAGENTS_USER_EMAIL=
INTERNAGENTS_USER_NAME=
INTERNAGENTS_INVITE_CODE=
INTERNAGENTS_GATEWAY_KEY=
OPENROUTER_API_KEY=
OPENROUTER_API_BASE=
DEEPAGENT_MODEL=
```

Set `DEEPAGENT_MODEL` to override the model explicitly:

```env
DEEPAGENT_MODEL=openrouter:deepseek-v4-flash
```

集思 exposes an OpenAI-compatible chat-completions endpoint, while the local
LangChain integration uses the existing OpenRouter ChatModel path. The gateway
origin itself is fixed by the local backend and is not a UI setting. The UI keeps
the model mode configurable: automatic selection writes `jisi/auto`, while
manual selection writes the chosen model ID. Real keys should stay in an
untracked `.env` or in the desktop app's Application Support runtime directory;
they should not be committed.

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

## Software Updates

The About page includes a local software update panel. The installed macOS app
checks a GitHub Releases feed for binary DMG assets. By default it reads:

```text
InternScience/InternAgents
```

Set `INTERNAGENTS_UPDATE_REPO=owner/release-repo` when launching the app to use
a public release-only repository. The source repository can stay private; the
release repository only needs GitHub Releases with assets named like
`InternAgents-0.1.1-arm64.dmg`, `InternAgents-0.1.1-x64.dmg`, and
`internagents-backend-cli.tar.gz`.

Public release repositories do not require a token. The updater first tries the
GitHub Releases API and, if the unauthenticated API is rate-limited, falls back
to the public release page plus `releases/latest/download/...`. Set
`INTERNAGENTS_UPDATE_GITHUB_TOKEN` only when you want a higher GitHub API rate
limit or when you intentionally check a private release repository.

The browser never receives a shell command or user-provided repository URL. It
calls local Next.js API routes under `/api/update/*`; those routes are the only
place that can query the fixed release feed, download the matching DMG, mount
it, verify the `.app`, and launch the local installer script that replaces the
current app and reopens InternAgents.

When a user selects a local-managed SSH workspace, the local Next.js API also
checks the same release repository for the backend CLI package matching the
current local app version, for example `v0.1.1`. If the remote runtime has not
recorded that release tag, the API downloads `internagents-backend-cli.tar.gz`,
uploads it over SSH, installs it in the remote user state directory, restarts
that resource runtime, and rewrites the local resource metadata. The resource
metadata also remembers the remote install mode, custom Python path, or
Conda/Mamba command chosen during setup so later syncs can reuse the same
environment strategy. Set
`INTERNAGENTS_REMOTE_BACKEND_UPDATE_REPO` only when the backend package should
come from a different release repository than the app updater. Like the app
updater, the remote backend sync first tries the GitHub Releases API and falls
back to the public fixed-tag download URL
`releases/download/<local-tag>/internagents-backend-cli.tar.gz` when the API is
rate-limited or unavailable. Set
`INTERNAGENTS_REMOTE_BACKEND_UPDATE_GITHUB_TOKEN` only when you need a higher
GitHub API rate limit or intentionally use a private backend release repository.

Publishing a new desktop release is tag driven. Create the tag on the branch or
commit you want to ship, then push that tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow uses that tag as the App version, runs on macOS, validates Python
files, lints and builds the UI, builds the architecture-specific DMGs, clears
any existing uploaded release assets, and uploads both DMGs to
`InternScience/InternAgents` together with `internagents-backend-cli.tar.gz`. If
the workflow runs in a private source repository,
set:

```text
Repository secret:   INTERNAGENTS_RELEASE_TOKEN=<PAT with contents:write on that repo>
```

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
  --n-jobs-per-worker 5 \
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

## Desktop Packaging

The desktop packaging entrypoint lives in `desktop/`. It builds the Next.js UI
as a standalone server, copies an InternAgents runtime template, bundles a
Python runtime, and asks `electron-builder` to produce native desktop artifacts.

```bash
cd desktop
npm install
npm run build
```

On macOS, `npm run build` produces a DMG for the current machine architecture.
To build a specific architecture, run `npm run build:arm64` for Apple Silicon
or `npm run build:x64` for Intel. The bundled Python runtime must match the
target architecture, so the release workflow builds each DMG on a matching
GitHub-hosted macOS runner.

By default `desktop/scripts/prepare-dist.mjs` copies `.conda` as the bundled
Python runtime, falling back to `.venv`. To use a prepared portable runtime,
set:

```bash
INTERNAGENTS_PYTHON_RUNTIME_SOURCE=/path/to/python-runtime npm run build
```

On Windows, provide a Python runtime whose executable is available at
`venv\Scripts\python.exe`, `python.exe`, `Scripts\python.exe`, or
`bin\python.exe`, then build the NSIS installer:

```powershell
cd desktop
npm install
$env:INTERNAGENTS_PYTHON_RUNTIME_SOURCE = "C:\path\to\python-runtime"
npm run build:win
```

If the NSIS installer dependencies are unavailable on the build machine, create
a distributable ZIP instead. To build both Windows artifacts from one prepared
dist directory, use:

```powershell
npm run build:win:zip
npm run build:win:all
```

The same prepare step also builds the remote backend CLI package used by the
web UI's "new remote workspace" flow:

```text
dist-app/internagents-template/backend-wheelhouse
dist-app/internagents-template/internagents-backend-cli.tar.gz
```

`backend-wheelhouse` contains the pinned Python dependencies for supported
remote Linux targets, and `internagents-backend-cli.tar.gz` contains the
runtime source plus that wheelhouse. Packaged desktop builds set
`INTERNAGENTS_DESKTOP=1`, so remote setup only uploads the prebuilt archive; it
does not build or download backend dependencies on the user's machine at setup
time. If the archive is missing from a desktop build, remote setup fails fast
instead of falling back to source-directory sync.

The remote host still needs a working `python3` with `venv` support. The bundled
wheelhouse currently targets Linux x86_64, Python 3.11/3.12, and glibc 2.28 or
newer.

The packaged app writes real user configuration under the platform application
data directory and starts the UI with:

```text
INTERNAGENTS_APP_ROOT=<app data>/InternAgents/runtime
INTERNAGENTS_DESKTOP=1
NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:<dynamic-port>
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent_local
```

First launch opens the local workbench and redirects to setup if 集思 is missing
credentials. The user's virtual key belongs in the desktop runtime `.env`; real
DeepSeek and LiteLLM master keys belong only in the separate
`internagents-gateway` deployment.

### Publishing Desktop Releases

Desktop releases are tag driven from the source repository
`qzzqzzb/InternAgents`. Create and push a semver tag on the commit you want to
ship:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The GitHub Actions workflow builds Apple Silicon (`arm64`) and Intel (`x64`)
macOS DMGs plus Windows x64 EXE/ZIP artifacts, then publishes them to the
public release repository `InternScience/InternAgents`. The same release also
includes `internagents-backend-cli.tar.gz`, which SSH workspaces use to sync
their remote backend runtime to the local app version. Because the workflow
runs in the source repository, configure the cross-repository token there:

```text
qzzqzzb/InternAgents -> Settings -> Secrets and variables -> Actions
New repository secret:
Name:  INTERNAGENTS_RELEASE_TOKEN
Value: <GitHub PAT>
```

Recommended PAT: fine-grained token with repository access limited to
`InternScience/InternAgents`, `Contents: Read and write`, and default `Metadata`
read access. If using a classic token, grant `repo`.

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
  --n-jobs-per-worker 5 \
  --config langgraph.runtime.json

python -m langgraph_cli dev \
  --host 127.0.0.1 \
  --port 2024 \
  --no-browser \
  --n-jobs-per-worker 5 \
  --config langgraph.json
```

Remote resources can be created from the web UI by selecting either an SSH
config host or a raw SSH command such as `ssh -p 2222 user@example.com`. The
setup API uploads the bundled `internagents-backend-cli.tar.gz`, installs it on
the remote host with `pip install --no-index --find-links backend-wheelhouse`,
starts `internagents-backend runtime start`, and opens the local SSH tunnel to
the remote runtime. Store the concrete SSH command, workspace, and tunnel URL
only in local config.

For manual debugging, the same runtime pattern still applies: start
`langgraph.runtime.json` on the remote machine with
`INTERNAGENT_PROCESS_ROLE=runtime` and the matching `INTERNAGENT_RUNTIME_ID`,
then expose it to the coordinator through an existing SSH tunnel. Do not change
server network, firewall, SSH daemon, security-group, or routing settings for
this setup; if a runtime is not reachable with existing access, fix the local
resource config, credentials, process, package install, or tunnel instead.

If a resource sets `kb_path`, InternAgents will best-effort run `kb sync pull`
before each agent run and `kb sync push` after the run using that resource's
backend.
