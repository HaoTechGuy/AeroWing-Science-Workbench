<div align="center">
  <h1 align="center">InternAgentS</h1>
  <p align="center">
    A local-first research agent workbench for DeepAgents, LangGraph, project files, skills, and scientific workflows.
  </p>
  <p align="center">
    <a href="https://github.com/qzzqzzb/OpenClaudeScience/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/qzzqzzb/OpenClaudeScience?style=social"></a>
    <img alt="Python" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white">
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs">
    <img alt="LangGraph" src="https://img.shields.io/badge/LangGraph-runtime-1f6feb">
    <img alt="Status" src="https://img.shields.io/badge/status-active%20development-0f766e">
  </p>
  <p>
    <a href="#quick-start">Quick Start</a>
    · <a href="#feature-highlights">Features</a>
    · <a href="#architecture">Architecture</a>
    · <a href="#development">Development</a>
    · <a href="#contributing">Contributing</a>
  </p>
</div>

InternAgentS gives researchers and developers a local browser workbench for
agentic research tasks. It combines a DeepAgents/LangGraph runtime, project file
preview, reusable skills, model configuration, and MCP/SCP connector setup in
one UI.

The project is still early, but it is already useful as a local research
assistant shell: open a project, configure a model, browse files, start a
conversation, and add domain skills as your workflow grows.

## Quick Start

### Requirements

- Python 3.11+
- Node.js and npm
- An OpenAI-compatible model endpoint, or the option to configure one later

### Start the Workbench

```bash
cp .env.example .env
./scripts/dev.sh
```

The launcher prepares the local environment and starts three services:

| Service | Default URL | Purpose |
| --- | --- | --- |
| UI | `http://127.0.0.1:3000` | Next.js workbench |
| Coordinator | `http://127.0.0.1:2024` | LangGraph API for the browser UI |
| Local runtime | `http://127.0.0.1:22024` | Project-scoped DeepAgent runtime |

Open:

```text
http://127.0.0.1:3000/?assistantId=agent_local
```

Logs are written to:

```text
.internagents/logs/backend.log
.internagents/logs/local-runtime.log
.internagents/logs/ui.log
```

Press `Ctrl+C` in the launcher terminal to stop the services started by the
script.

### Configure a Model

You can configure a model during first setup, or skip it and return later from
Settings. For an OpenAI-compatible endpoint:

```env
INTERNAGENTS_MODEL_PROVIDER=openai_compatible
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=sk-...
DEEPAGENT_MODEL=your-model-id
```

Keep API keys and machine-specific paths in local `.env` or runtime config
files. Do not commit secrets.

### Useful Overrides

```bash
INTERNAGENTS_UI_PORT=3001 ./scripts/dev.sh
INTERNAGENTS_BACKEND_PORT=2025 ./scripts/dev.sh
INTERNAGENTS_OPEN_BROWSER=0 ./scripts/dev.sh
INTERNAGENTS_SKIP_INSTALL=1 ./scripts/dev.sh
```

## Feature Highlights

### Local-First Research Workspace

InternAgentS is organized as a three-panel workspace:

| Area | What it does |
| --- | --- |
| Left sidebar | project navigation, sessions, settings, and skill entry points |
| Center | chat, composer, attachments, mentions, and agent progress |
| Right panel | project files, previews, provenance, runtime info, and connector context |

Project files are accessed through the workspace API rather than direct UI file
system calls. The file panel supports directory navigation, grid/list views,
search, and previews for common research artifacts.

### DeepAgents + LangGraph Runtime

InternAgentS exports LangGraph assistants from `agent.py`:

- `agent`
- `agent_local`
- `agent_remote1` through `agent_remote8`

The coordinator and local runtime are separate processes. This keeps UI
connection logic, project execution, workspace state, and future remote
resource support easier to maintain.

### Skills and Science Capability Library

Skills are reusable capabilities that can be enabled for an agent or session.
InternAgentS searches shared user catalogs first, then project catalogs:

```text
~/.internagents/myskills
~/.internagents/imported-skills
skills
.internagents/imported-skills
```

The settings UI supports built-in skills, imported skills, and science skills.
Imported skills are copied into a user-level catalog so the same capability can
be reused across multiple projects.

### Model, Authorization, and Appearance Settings

The unified settings page manages:

- model provider, Base URL, API key, and model ID
- project directory
- tool-call authorization mode
- language and appearance
- archived conversations
- skills and connector configuration

The UI includes both Chinese and English copy.

### MCP and SCP Connectors

InternAgentS can load external tools through MCP server configuration and can
prepare SCP Hub access for science skill workflows.

Local MCP config locations:

```text
~/.deepagents/.mcp.json
<repo>/.deepagents/.mcp.json
<repo>/.mcp.json
INTERNAGENT_MCP_CONFIG_FILE
```

Connector secrets, private commands, headers, and endpoints should stay local.

## Architecture

```mermaid
flowchart LR
  Browser["Browser UI<br/>Next.js"] --> Coordinator["LangGraph coordinator<br/>agent.py"]
  Coordinator --> Runtime["Local runtime<br/>DeepAgent"]
  Runtime --> Workspace["Project workspace<br/>files, shell, skills"]
  Runtime --> MCP["MCP servers"]
  Runtime --> SCP["SCP Hub"]
```

## Repository Map

```text
agent.py                         LangGraph graph assembly and assistant exports
deepagent.config.json            local backend, skills, model, and UI defaults
internagent_resources.py         resource configuration loader
ssh_backend.py                   SSH-backed workspace adapter
thread_skill_middleware.py       thread-level skill loading
mcp_config.py / mcp_tools.py      MCP configuration and tool loading
scripts/dev.sh                   one-command local development launcher
ui/                              Next.js workbench UI
skills/                          bundled project skills
docs/                            user guides and design notes
```

## Development

Run these checks before opening a pull request:

```bash
git diff --check
python3 -m json.tool deepagent.config.json >/dev/null
python3 -m json.tool internagent.resources.json >/dev/null
python3 -m json.tool ui/deepagent-ui.config.json >/dev/null
npm --prefix ui run lint
npm --prefix ui run build
```

For Python backend changes:

```bash
.venv/bin/python -m compileall agent.py internagent_resources.py ssh_backend.py kb_sync_middleware.py thread_skill_middleware.py
.venv/bin/python -c "import agent; print(agent.MODEL)"
```

## Contributing

InternAgentS is shaped as an open research tool. Helpful contributions include:

- bug reports with clear reproduction steps
- UI polish that keeps existing workflows stable
- new skills with examples and safe defaults
- connector integrations that keep secrets local
- documentation for installation, configuration, and research workflows

Please keep changes scoped. DeepAgents is treated as an external SDK, so
InternAgentS should extend it through public APIs, adapters, middleware, tools,
and local resource configuration rather than patching SDK internals.

## Roadmap Notes

Near-term areas of work:

- clearer skill marketplace and installation flow
- stronger MCP and SCP configuration UX
- richer previews for scientific artifacts
- better remote resource management
- packaged desktop workflows

This README is intentionally lightweight. More detailed design notes live in
`docs/`, and the public onboarding story will keep evolving as the interface
stabilizes.
