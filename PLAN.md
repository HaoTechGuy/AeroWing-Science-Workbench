# 本地 DeepAgent + 官方 Deep Agents UI MVP 计划

## Summary

基于当前仓库 `/Users/qszhang/Documents/codex/deepagent` 做最小可跑版本：把现有 `main.py` 的 demo agent 改造成一个标准 LangGraph graph，再用官方 `langchain-ai/deep-agents-ui` 作为独立前端连接它。整体形态是：

```text
官方 deep-agents-ui: http://localhost:3000
  -> LangGraph API: http://127.0.0.1:2024
  -> 当前仓库里的 DeepAgent graph: agent
```

不写自定义 FastAPI 转发层；直接采用官方 UI 的 LangGraph SDK 连接方式。

## Key Changes

- 在当前仓库根目录新增 `agent.py`，导出模块级变量 `agent`：
  - 复用现有 `get_weather(city: str)` 工具。
  - 使用 `create_deep_agent(...)` 创建 graph。
  - 模型读取 `DEEPAGENT_MODEL`，默认 `openai:gpt-5.4`。
  - 使用 `LocalShellBackend(root_dir=当前仓库根目录, inherit_env=True)`，让 agent 可以在本地仓库内读写文件和执行 shell。
  - 配置 `interrupt_on`，至少拦截 `execute`、`write_file`、`edit_file`、`task`，让官方 UI 能展示 approve/reject 流程。

- 保留 `main.py` 作为命令行 smoke test，但改成复用 `agent.py` 里的 `agent`，避免 CLI demo 和 UI graph 定义分叉。

- 新增 `langgraph.json`：
  ```json
  {
    "dependencies": ["."],
    "graphs": {
      "agent": "./agent.py:agent"
    },
    "env": ".env"
  }
  ```

- 新增或完善根目录 `pyproject.toml`，让 `langgraph dev` 能把当前目录作为可安装项目加载：
  - 依赖包含 `deepagents>=0.5.7`、`langchain-openai`、`langgraph-cli[inmem]`、`python-dotenv`。
  - 使用 setuptools，声明 `py-modules = ["agent", "main"]`。

- 更新 `.env.example` 和 `README.md`：
  - `.env.example` 包含 `OPENAI_API_KEY=` 和 `DEEPAGENT_MODEL=openai:gpt-5.4`。
  - README 增加两个终端的启动步骤：一个跑 LangGraph server，一个跑官方 UI。

## Local Run Flow

1. Python 环境：

   ```bash
   cd /Users/qszhang/Documents/codex/deepagent
   source .venv/bin/activate
   pip install -e .
   cp .env.example .env
   # 编辑 .env，填 OPENAI_API_KEY
   ```

2. 启动本地 DeepAgent LangGraph API：

   ```bash
   cd /Users/qszhang/Documents/codex/deepagent
   source .venv/bin/activate
   python -m langgraph_cli dev \
     --host 127.0.0.1 \
     --port 2024 \
     --no-browser \
     --config langgraph.json
   ```

3. 启动官方 UI：

   ```bash
   cd /Users/qszhang/Documents/codex
   git clone https://github.com/langchain-ai/deep-agents-ui.git
   cd deep-agents-ui
   corepack enable
   yarn install
   yarn dev
   ```

4. 在 `http://localhost:3000` 里填写：
   - `Deployment URL`: `http://127.0.0.1:2024`
   - `Assistant ID`: `agent`
   - `LangSmith API Key`: 本地可留空

## Test Plan

- 后端健康检查：
  - 打开 `http://127.0.0.1:2024/ok`，应返回健康状态。
  - 打开 `http://127.0.0.1:2024/docs`，确认 LangGraph API 可访问。

- UI 聊天验证：
  - 在官方 UI 发送：“你好，介绍一下你能做什么。”
  - 发送：“请使用 get_weather 工具查询 Shanghai 的天气。”
  - 应看到 assistant 回复，并能在消息流里看到工具调用或工具结果。

- 本地能力验证：
  - 发送：“请列出当前项目根目录有哪些文件。”
  - UI 应出现工具审批卡片；批准后 agent 返回目录信息。
  - 发送：“请创建一个 `notes/ui-test.txt`，内容是 hello deep agents ui。”
  - UI 应出现写文件审批；批准后文件应出现在仓库内。

- Thread 验证：
  - 刷新官方 UI。
  - 左侧 thread/history 应能看到刚才的会话。
  - 点回旧 thread 后，消息历史应恢复。

## Assumptions

- 第一版只做当前仓库 MVP，不做一键启动命令。
- 官方 `deep-agents-ui` 作为独立 checkout 运行，不拷贝进当前 Python 仓库。
- 本地默认端口固定为 `2024` 和 `3000`；如端口冲突，手动换端口。
- 使用 OpenAI 模型作为默认模型；后续可通过 `DEEPAGENT_MODEL` 改成 Anthropic、Gemini 等 LangChain 支持的 provider。
- 本地 shell 能力仅用于开发机自用；所有危险工具调用必须走 UI approval。
