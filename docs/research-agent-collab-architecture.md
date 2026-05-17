# 面向科研团队协作的 Agent Infra 与 Runtime 架构方案

> 版本：V1 技术选型草案  
> 目标：为科研团队提供一个 Git-native、Agent-native、可追溯、可解耦的协作系统。  
> 当前设计重点：**infra CLI / infra core** 与 **agent runtime backend** 的边界划分。
> 执行拆分：MVP/PRD 见 `docs/research-agent-collab-prd.md`；CLI 合约见 `docs/kb-cli-spec.md`；Runtime 事件合约见 `docs/runtime-event-schema.md`。
> 设计修正：`kb` client 不应写死 `experiment` / `proposal` 等领域命令；内容类型由 `kb.yaml` 的 `domains` 定义，CLI 提供通用 `domain` 与 `change` 原语。原文中的 `kb experiment ...` / `kb proposal ...` 示例应按 `docs/kb-cli-spec.md` 的 domain-driven 合约理解。

---

## 1. 核心结论

本方案建议将系统拆成两个相对独立的后端能力：

1. **Agent Runtime Backend**  
   负责 agent 会话、运行生命周期、事件持久化、前端事件流、sandbox、工具调用、checkpoint、取消/恢复等运行时能力。

2. **Infra CLI / Infra Core**  
   以独立 CLI 的形式提供给人类和 agent 使用，负责知识库 Git 操作、同步、检索、归档、配置管理、实验进度记录、proposal/PR 创建等能力。

最终形态不是一个传统 server-first backend，而是：

```text
Frontend
  ↓
Agent Runtime Backend
  ↓ process call / MCP client
Infra CLI / Infra Core
  ↓
Git-based Knowledge Repositories
```

这样 built-in agent、Claude Code、Codex、Gemini CLI、学生自己的 agent、人类终端都可以通过同一个 infra CLI 访问知识库能力。

---

## 2. 设计目标与非目标

### 2.1 设计目标

- 支持科研团队成员和各自 agent 共享团队知识。
- 支持本地/个人知识库与团队知识库之间的同步和归档。
- 支持 agent 将调研、组会材料、实验进度等整理成 proposal，并最终并入团队知识库。
- 所有 agent 会话、操作、知识变更、重要产物引用都应可追溯。
- infra 能力应作为独立 CLI 暴露，而不是只作为 runtime backend 内部服务。
- 内置 agent runtime 只需要质量“基本够用”，重点是接口、持久化、前端交互和工具调用。
- 知识库结构不应固定，应提供默认配置，但允许用户和 agent 修改。
- 暂时不做 RAG indexer，检索由 agent 通过 CLI 自主完成。

### 2.2 当前非目标

- 不做完整向量检索/RAG 系统。
- 不做大文件、数据集、模型权重的主存储系统。
- 不强制选择某个 agent runtime 框架，例如 LangGraph。
- 不在 V1 做复杂权限系统，只预留 policy/approval 接口。
- 不在 V1 强依赖 A2A。
- 不做复杂 CRDT 协同编辑。
- 不做完整 experiment tracker；实验进度先作为知识库内容记录。

---

## 3. 总体架构

```text
Frontend
  ├─ Agent Run Console
  ├─ KB Browser / Diff Viewer
  ├─ Proposal / PR Review
  └─ Experiment Notes Viewer

Agent Runtime Backend
  ├─ Run / Thread / Event API
  ├─ SSE / WebSocket event stream
  ├─ Tool Runner
  │   ├─ process tool: call `kb ...`
  │   └─ MCP client: connect to `kb mcp-server`
  ├─ Sandbox / Workspace Manager
  ├─ Checkpoint / resume / cancel
  ├─ Approval interface, V1 可 all-allow
  └─ Postgres event ledger

Infra CLI / Infra Core
  ├─ kb init / attach / sync / status
  ├─ kb tree / find / grep / read / history / diff
  ├─ kb note / doc / seminar / experiment
  ├─ kb propose / pr / commit
  ├─ kb config get / set / patch / validate / propose
  ├─ kb mcp-server
  ├─ kb daemon, optional
  └─ Git forge adapter: Gitea / GitLab / GitHub

Storage
  ├─ Git repos: knowledge source of truth
  ├─ Postgres: agent run / event / audit source of truth
  ├─ Local SQLite, optional: CLI cache/state
  └─ Object storage, optional only for runtime-generated temporary files
```

最重要的边界是：

```text
Git      = 知识内容真源
Postgres = agent 行为与系统事件真源
CLI      = agent 和人类操作知识库的统一入口
Runtime  = agent 会话与执行环境管理器
```

---

## 4. Infra CLI 设计

### 4.1 为什么 infra 应该做成 CLI

将 infra 后端能力做成 CLI 有几个明显优势：

- agent 不需要知道你的后端内部 API。
- 人类可以直接在终端使用同一套能力。
- 外部 agent 可以通过 shell tool 或 MCP 调用 CLI。
- built-in runtime 和 infra 能力自然解耦。
- 本地项目、本地知识库、团队知识库的交互更自然。
- 更接近当前主流 agent CLI 的使用方式。

推荐命名可以是：

```bash
kb
research-kb
lab-kb
rk
```

下文统一用 `kb` 表示。

---

### 4.2 CLI 的三层命令结构

建议 CLI 参考 agent-native CLI 的模式，分成三层：

```text
Layer 1: shortcuts
  给人和 agent 快速使用。

Layer 2: structured commands
  给 agent 稳定调用，输出结构化 JSON。

Layer 3: raw / advanced commands
  给高级用户、自动化脚本和特殊集成使用。
```

#### Layer 1: shortcuts

示例：

```bash
kb status
kb sync
kb daily-note
kb archive-seminar
kb experiment-progress
kb proposal
```

这些命令应该有 smart defaults，适合人类和 agent 快速使用。

#### Layer 2: structured commands

示例：

```bash
kb repo status --json
kb tree --max-depth 3 --json
kb find "GPU 使用手册" --limit 8 --json
kb grep "slurm" --path handbook/ --context 3 --json
kb read handbook/compute/slurm.md --range 1:120 --json
kb history seminars/2026-05-foo/summary.md --json
kb diff --base main --head proposal/alice/foo --json
kb doc create --template seminar --json
kb experiment append --project xxx --json
kb proposal create --from-path notes/foo.md --json
```

这层是 agent 最主要的调用对象。

#### Layer 3: raw / advanced commands

示例：

```bash
kb git commit
kb git branch
kb forge pr create
kb config patch
kb raw gitea ...
kb raw gitlab ...
```

这些命令用于高级场景，普通 agent 默认不一定需要使用。

---

### 4.3 Agent-friendly CLI 输出规范

CLI 必须对 agent 友好。建议采用以下规范：

```text
stdout = 机器可解析 JSON / JSONL
stderr = 日志、警告、debug
exit code = 稳定语义
--json = agent 默认输出
--table = 人类友好输出
--compact = token-friendly 输出
--limit / --range = 控制上下文大小
--dry-run = 让 agent 先展示将要做什么
```

示例：

```bash
kb grep "slurm" --path handbook/ --context 2 --json --limit 5
```

输出：

```json
{
  "query": "slurm",
  "results": [
    {
      "path": "handbook/compute/slurm.md",
      "line_start": 12,
      "line_end": 18,
      "snippet": "...",
      "commit": "abc123"
    }
  ],
  "next_cursor": null
}
```

错误示例：

```json
{
  "error": {
    "code": "KB_REPO_NOT_FOUND",
    "message": "No knowledge repository found in current directory.",
    "suggested_commands": [
      "kb init",
      "kb attach --path .research-kb"
    ]
  }
}
```

---

### 4.4 CLI 的运行形态

推荐提供四种形态：

```text
1. 普通 CLI
   kb status
   kb sync
   kb grep ...

2. Agent 非交互 CLI
   kb status --json
   kb propose ... --json --dry-run

3. MCP server
   kb mcp-server
   让 Claude Code / Codex / Gemini CLI / built-in runtime 作为 MCP client 连接

4. Optional local daemon
   kb daemon
   用 Unix socket / localhost HTTP 缓存认证、repo 状态、长任务
```

V1 可以只做前 3 个。`kb daemon` 可以后置。

---

## 5. CLI + MCP 设计

### 5.1 为什么 CLI 也要有 MCP 能力

很多 agent 系统已经支持 MCP server。将 infra CLI 同时作为 MCP server，可以让外部 agent 不需要通过 shell 命令字符串调用，而是通过结构化 tool 调用使用知识库能力。

建议命令：

```bash
kb mcp-server
```

### 5.2 MCP tools 设计

建议暴露以下 MCP tools：

```text
kb.repo_status
kb.repo_sync
kb.tree
kb.find
kb.grep
kb.read
kb.history
kb.diff
kb.note_create
kb.doc_create
kb.experiment_append
kb.proposal_create
kb.pr_create
kb.config_get
kb.config_patch
```

这些 MCP tools 可以直接复用 CLI core，不要重复实现业务逻辑。

内部结构：

```text
CLI command parser
  ↓
Infra Core library
  ↓
Git adapter / config manager / proposal manager
  ↑
MCP server tools
```

也就是说：

```text
kb grep ...
```

和：

```text
MCP tool: kb.grep
```

底层调用同一段 infra core 逻辑。

---

## 6. 知识库结构：默认模板 + 可配置

### 6.1 不固定知识库目录结构

知识库结构不应该强制固定。不同科研团队有不同习惯：

- 有的以项目为中心；
- 有的以论文调研为中心；
- 有的以实验记录为中心；
- 有的以组会分享为中心；
- 有的以集群/计算资源手册为中心。

所以系统只提供默认模板，不做强制。

默认结构可以是：

```text
team-kb/
  AGENTS.md
  kb.yaml
  handbook/
  projects/
  seminars/
  experiments/
  literature/
  protocols/
  templates/
```

其中：

```text
AGENTS.md = 给 agent 的知识库操作说明
kb.yaml   = 知识库配置文件
```

---

### 6.2 `kb.yaml` 配置

核心不是目录结构，而是配置文件。

示例：

```yaml
version: 1

repo:
  kind: team-kb
  default_branch: main

content:
  roots:
    handbook: handbook/
    projects: projects/
    seminars: seminars/
    experiments: experiments/
    literature: literature/

templates:
  seminar: templates/seminar.md
  experiment_progress: templates/experiment-progress.md
  project_note: templates/project-note.md

metadata:
  frontmatter: optional
  allowed_types:
    - note
    - seminar
    - experiment_progress
    - handbook
    - literature_review

search:
  mode: grep
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

proposal:
  require_human_review: false
  branch_prefix: proposal/
```

agent 可以修改配置，但建议区分：

```text
个人知识库配置：可直接修改
团队知识库配置：建议通过 proposal / PR 修改
```

示例：

```bash
kb config get --json
kb config patch --set content.roots.experiments=lab-notes/experiments --dry-run
kb config propose --title "Change experiment notes directory"
```

---

## 7. 不做 RAG：使用 agent-controlled retrieval

当前版本暂时不做 RAG indexer。检索信息由 agent 自己通过 CLI 完成。

### 7.1 推荐检索命令

```bash
kb tree --max-depth 3 --json
kb find "slurm gpu quota" --json
kb grep "A100" --context 3 --json
kb read handbook/compute/slurm.md --range 1:120 --json
kb recent --since 30d --json
kb history projects/foo/experiments/run-001.md --json
kb blame handbook/compute/slurm.md --json
kb backlinks projects/foo --json
kb frontmatter query 'type == "experiment_progress" and project == "foo"'
```

这些命令提供的是 structured repo navigation，而不是向量召回。

### 7.2 `kb map`

可以提供一个非向量的知识库地图：

```bash
kb map build
kb map show --json
```

生成：

```text
KB_MAP.md
.kb/map.json
```

`KB_MAP.md` 可以记录：

- 目录结构；
- 文档标题；
- tags；
- 简短摘要；
- 最近更新时间；
- 重要文件入口。

它是 Git 中的普通文件，可以由人类或 agent 维护。它不是隐藏索引，也不是 RAG。

---

## 8. 个人知识库到团队知识库的同步流程

典型流程：

```text
个人本地知识 / personal branch
        ↓
agent 辅助整理成 archival doc
        ↓
创建 proposal branch
        ↓
infra CLI 创建 PR / MR
        ↓
人类 review
        ↓
merge 到 team-kb main
        ↓
团队知识库更新
```

示例：

```bash
kb doc create --template seminar --title "Agent Collaboration Framework Survey"
kb proposal create --from-path seminars/2026-05-agent-collab/summary.md --dry-run
kb proposal create --from-path seminars/2026-05-agent-collab/summary.md
kb pr create --title "Archive seminar: Agent Collaboration Framework Survey"
```

原则：

```text
agent 不直接 push 到 main
agent 可以创建 branch / commit / PR
团队知识库 merge 应经过人类 review 或策略审批
每个重要 commit 应能关联到 agent run / session / user
```

建议 commit message 中带 trailer：

```text
Agent-Run-ID: run_01HX...
Session-ID: thread_abc...
Generated-By: built-in-runtime
Reviewed-By: alice
Source-Refs: local-note-123, experiment-run-456
```

---

## 9. Git 服务选型

不要自己实现 Git server。建议 infra CLI / backend 做 Git forge adapter。

```text
GitService
  create_branch()
  create_commit()
  open_pull_request()
  get_diff()
  list_reviews()
  merge_pull_request()
  resolve_ref()
  get_file_at_ref()
  subscribe_webhook()
```

推荐选择：

| 场景 | 推荐 |
|---|---|
| 小到中型科研团队，自托管，轻量 | Gitea |
| 需要企业 CI/CD、权限、安全扫描 | GitLab Self-Managed |
| 团队已经在 GitHub | GitHub / GitHub Enterprise |

V1 可以优先支持一个 Git forge，然后通过 adapter 扩展。

---

## 10. 大文件、数据集与外部资产

当前设计中，大文件、数据集、模型权重一般不依赖本系统存储。知识库只记录如何操作、如何访问、如何复现实验。

也就是说：

```text
大文件 / 数据集 / 模型权重 = 外部系统管理
知识库 = 操作说明、路径、访问方式、版本引用、实验记录
```

示例：

```yaml
external_assets:
  - kind: dataset
    name: imagenet-subset-v3
    location: /cluster/datasets/imagenet-subset-v3
    access_note: "见 handbook/compute/datasets.md"

  - kind: checkpoint_dir
    path: /cluster/checkpoints/project-a/run-42

  - kind: slurm_job
    id: "123456"

  - kind: paper_pdf
    location: zotero://select/items/ABC123
```

这样可以避免系统一开始变成复杂的数据平台。

---

## 11. 知识历史 vs 资产历史

### 11.1 知识历史

知识历史是 Git 中的文本历史。

包括：

```text
组会文档
实验记录
操作手册
论文调研
项目决策
配置文件
模板
AGENTS.md
```

它回答：

```text
谁在什么时候改了哪段知识？
这个知识是怎么进入团队知识库的？
哪个 PR / commit 引入了它？
它现在是不是团队认可的版本？
```

### 11.2 资产历史

在当前方案中，资产历史不是资产本身，而是外部资产引用的历史。

例如：

```yaml
assets:
  - kind: dataset
    name: imagenet-subset-v3
    location: /cluster/datasets/imagenet-subset-v3

  - kind: model_checkpoint
    location: s3://lab-bucket/project-a/run-42/checkpoint.pt

  - kind: cluster_job
    scheduler: slurm
    job_id: "123456"

  - kind: slide
    location: lark://doc/xxxx
```

它回答：

```text
某个实验记录引用了哪些外部数据 / 模型 / 日志？
某个组会文档背后有哪些实验产物？
agent 生成的文档来自哪些文件或外部记录？
```

V1 中，资产历史可以完全作为知识库中的 manifest 存在，不需要单独 asset service。

---

## 12. 实验进度追踪

当前不接完整 MLflow / Aim / W&B，而是把实验进度作为本地知识库的一部分。

推荐命令：

```bash
kb experiment init --project diffusion-agent
kb experiment append --project diffusion-agent --title "lr sweep batch 3"
kb experiment status --project diffusion-agent
kb experiment archive --project diffusion-agent --run run-2026-05-16-001
```

生成文件示例：

```text
experiments/
  diffusion-agent/
    2026-05-16-run-001.md
    2026-05-16-run-001.assets.yaml
```

实验记录示例：

```markdown
---
type: experiment_progress
project: diffusion-agent
date: 2026-05-16
owner: alice
status: running
tags: [lr-sweep, a100]
external_assets:
  - kind: slurm_job
    id: "123456"
  - kind: checkpoint_dir
    path: "/cluster/checkpoints/diffusion-agent/run-001"
---

# Experiment Progress

## Goal

Compare learning rates 1e-4, 3e-4, 1e-3.

## Current status

- 1e-4 stable
- 3e-4 best validation loss so far
- 1e-3 diverged after 2k steps

## Next action

Run longer 3e-4 baseline.
```

后续可以再做 connector：

```bash
kb experiment import --from mlflow --run-id ...
kb experiment import --from wandb --run-id ...
```

但这不是 V1 必须能力。

---

## 13. Agent Runtime Backend 功能边界

当前不强制选择 LangGraph 或其他框架。先定义 runtime backend 必须具备的能力。

### 13.1 Run lifecycle

```text
create
start
pause
resume
cancel
finish
```

### 13.2 Thread / session

需要区分：

```text
thread_id     = 一个长期上下文
run_id        = 一次 agent 执行
parent_run_id = 可选，用于嵌套 run 或重试
user_id       = 用户
workspace_id  = sandbox 工作区
```

### 13.3 Event streaming

事件类型建议包括：

```text
RUN_STARTED
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT
TEXT_MESSAGE_END
TOOL_CALL_STARTED
TOOL_CALL_ARGS
TOOL_CALL_RESULT
ARTIFACT_CREATED
APPROVAL_REQUESTED
STATE_SNAPSHOT
RUN_ERROR
RUN_FINISHED
```

### 13.4 Tool execution

支持：

```text
process tool:
  调用 kb CLI，例如 `kb grep ... --json`

MCP client:
  连接 `kb mcp-server`

shell tool:
  sandboxed shell

file tool:
  sandboxed file read/write
```

### 13.5 Persistence

```text
append-only event log
checkpoint
replay
export
```

### 13.6 Sandbox

每次 agent run 建议分配隔离 workspace：

```text
/workspaces/run_abc/
  project/              # 当前项目 repo
  .research-kb/         # local or team kb
  scratch/              # temporary files
  outputs/              # generated files
```

原则：

```text
agent 读取团队 KB 时，默认读固定 ref/commit
agent 写团队 KB 时，只能写 proposal branch
agent 不直接持有长期密钥
高风险操作走 approval hook
```

---

## 14. Runtime 数据模型

Postgres 中建议保留以下核心表。

### 14.1 agent_thread

```sql
agent_thread
  id
  project_id
  owner_id
  title
  visibility
  created_at
  updated_at
```

### 14.2 agent_run

```sql
agent_run
  id
  thread_id
  agent_id
  user_id
  model_provider
  model_name
  status
  input_summary
  git_ref
  sandbox_id
  trace_id
  started_at
  ended_at
```

### 14.3 agent_event

```sql
agent_event
  id
  run_id
  seq
  event_type
  actor_type        -- user / agent / tool / system
  payload_json
  payload_redacted
  prev_hash
  event_hash
  created_at
```

建议 `agent_event` append-only。对于审计场景，可以用 `prev_hash/event_hash` 做 tamper-evident chain。

### 14.4 tool_call

```sql
tool_call
  id
  run_id
  step_id
  tool_name
  args_json_redacted
  result_ref
  status
  approval_id
  started_at
  ended_at
```

### 14.5 knowledge_change

```sql
knowledge_change
  id
  run_id
  repo_id
  branch
  commit_sha
  pr_id
  diff_summary
  status
```

### 14.6 approval

```sql
approval
  id
  run_id
  action_type
  requested_by
  approved_by
  decision
  reason
  created_at
  decided_at
```

---

## 15. Frontend ↔ Runtime 接口

### 15.1 SSE / WebSocket / AG-UI-compatible

浏览器前端建议 V1 使用：

```text
SSE: server → client event stream
REST: client → server input / cancel / approval
```

API 示例：

```http
POST /api/runs
GET  /api/runs/{run_id}/events
POST /api/runs/{run_id}/input
POST /api/runs/{run_id}/cancel
POST /api/approvals/{approval_id}/decision
```

事件格式可以设计成 AG-UI-compatible，但不要强绑定某个 SDK。

示例：

```json
{
  "type": "TOOL_CALL_STARTED",
  "run_id": "run_123",
  "seq": 42,
  "tool": "kb.grep",
  "args_redacted": {
    "query": "slurm",
    "path": "handbook/"
  }
}
```

判断：

```text
SSE / WebSocket 事件流是主流实现方式。
AG-UI 是正在形成的开放协议，但不是唯一事实标准。
```

因此推荐：

```text
V1: AG-UI-like event schema + SSE
V2: 可选 WebSocket
IDE/CLI integration: 可单独考虑 JSON-RPC over stdio
```

---

## 16. External Agent 接入

### 16.1 当前判断

```text
agent ↔ tool:
  MCP 最重要、最常见

frontend ↔ agent:
  没有唯一事实标准
  AG-UI / 自定义 SSE / WebSocket / JSON-RPC 都可以

agent ↔ agent:
  A2A 是重要开放标准候选
  但 V1 不需要强依赖
```

### 16.2 V1 接入方式

外部 agent 可以通过三种方式接入：

```text
1. 直接调用 kb CLI
2. 连接 kb mcp-server
3. 调用简单 HTTP ingest API
```

HTTP ingest API 示例：

```http
POST /api/external-runs
POST /api/external-runs/{id}/events
POST /api/kb/proposals
POST /api/experiments/progress
```

### 16.3 V2 再考虑 A2A

A2A 可以后置：

```text
V1:
  CLI / MCP / HTTP ingest

V1.5:
  capability discovery / agent card

V2:
  A2A adapter
```

---

## 17. Git 知识库放在项目文件夹里的三种模式

你可以在每个项目文件夹中放知识库，并且让知识库和项目文件夹的 Git 管理独立。推荐支持三种模式。

---

### 17.1 模式 A：嵌套独立 repo，并让父 repo 忽略它

目录：

```text
project-a/              # 项目自己的 Git repo
  .git/
  src/
  experiments/
  .research-kb/         # 另一个独立 Git repo
    .git/
    notes/
    kb.yaml
```

父 repo 的 `.gitignore` 或 `.git/info/exclude` 写：

```gitignore
.research-kb/
```

使用：

```bash
cd project-a
git status              # 看项目代码

cd .research-kb
git status              # 看知识库
```

优点：

```text
简单
完全解耦
父项目不会记录知识库 commit
适合个人本地知识库
```

缺点：

```text
别人 clone project-a 时不会自动拿到 .research-kb
项目版本和知识库版本没有绑定
```

这是个人本地知识库的推荐默认模式。

---

### 17.2 模式 B：Git submodule

目录：

```text
project-a/
  .git/
  src/
  kb/                   # submodule
```

命令：

```bash
git submodule add git@server:team/team-kb.git kb
```

优点：

```text
父项目记录 kb 当前 commit
可复现：项目版本知道自己配套哪个知识库版本
适合正式项目归档
```

缺点：

```text
submodule 操作更麻烦
父项目会因为 kb commit pointer 变化而出现 diff
agent 操作时要更小心
```

如果希望“某个项目版本绑定某个知识库版本”，用 submodule。

---

### 17.3 模式 C：worktree / 共享 clone

适合多个项目目录都想挂同一个 team-kb，但不想重复 clone 一堆知识库。

CLI 可以管理：

```bash
kb attach --mode worktree --path .research-kb --repo team-kb --ref main
```

概念结构：

```text
~/.cache/research-kb/team-kb.git
project-a/.research-kb/
project-b/.research-kb/
project-c/.research-kb/
```

推荐 CLI 支持：

```bash
kb attach --mode ignored-subrepo
kb attach --mode submodule
kb attach --mode worktree
```

默认建议：

```text
个人知识库：ignored-subrepo
正式项目依赖：submodule
多个项目共享团队知识库：worktree
```

---

## 18. 权限与安全：V1 只预留接口

V1 可以暂时 all-allow，但要预留 policy hook。

示例配置：

```yaml
policy:
  default: allow
  rules:
    - action: kb.pr.merge
      decision: ask
    - action: kb.config.patch
      decision: ask
    - action: kb.sync.push
      decision: allow
```

即使 V1 不做复杂权限，也建议保留：

```text
--dry-run
approval hook
policy interface
redacted logging
tool timeout
scope-limited token
```

高风险动作未来可以进入审批流：

```text
merge PR
删除知识库文件
修改团队 kb.yaml
提交昂贵计算任务
访问敏感实验路径
对外发布文档
```

---

## 19. V1 推荐技术选型

### 19.1 Infra CLI

| 模块 | 推荐 |
|---|---|
| CLI 语言 | Rust 或 Go |
| Git 操作 | Git CLI / libgit2 / gitoxide，V1 可先包 Git CLI |
| 配置 | YAML: `kb.yaml` |
| 本地缓存 | SQLite，可选 |
| MCP | `kb mcp-server` |
| Git forge | Gitea / GitLab / GitHub adapter |
| 输出 | JSON / JSONL / human table |

V1 可优先用 Git CLI 包装实现，后续再替换为更底层的 Git 库。

### 19.2 Runtime Backend

| 模块 | 推荐 |
|---|---|
| API backend | FastAPI / Node.js / Go 均可 |
| Run event DB | PostgreSQL |
| Event stream | SSE 起步，WebSocket 可选 |
| Tool execution | process runner + MCP client |
| Sandbox | 本地隔离目录 / container 可选 |
| Observability | OpenTelemetry，可后续接 Langfuse |
| Agent framework | 暂不确定，先定义接口 |

### 19.3 Knowledge Repository

| 模块 | 推荐 |
|---|---|
| 真源 | Git |
| 文档格式 | Markdown / Quarto / LaTeX / YAML / BibTeX |
| 配置 | `kb.yaml` |
| Agent 指令 | `AGENTS.md` |
| 检索 | tree / find / grep / read / history / diff |
| 归档 | proposal branch + PR |

---

## 20. V1 必须完成的能力

建议 V1 目标：

```text
1. kb init / attach / status / sync
2. kb tree / find / grep / read / history / diff
3. kb config get / patch / validate
4. kb experiment append / status
5. kb proposal create
6. kb pr create, 至少支持一个 Git forge
7. kb mcp-server
8. runtime 可以调用 kb CLI 或连接 kb MCP server
9. runtime 记录 run / event / tool_call / knowledge_change
10. frontend 可以查看 run timeline、tool call、proposal、diff
11. 外部 agent 可以通过 CLI / MCP 提交知识 proposal 或实验进度
```

---

## 21. V1 可以暂缓的能力

```text
1. RAG / vector indexer
2. 完整 A2A
3. 复杂权限系统
4. 大文件 / 数据集 / 模型存储
5. 完整 experiment tracker
6. CRDT 协同编辑
7. 多 Git forge 全量支持
8. 企业级审计报表
9. 多 agent 自动协商
10. 长期 memory 系统
```

---

## 22. 推荐开发顺序

### Phase 1: Infra CLI MVP

```text
kb init
kb attach
kb status
kb tree
kb grep
kb read
kb config get
kb experiment append
kb proposal create --dry-run
```

目标：先让 agent 能稳定读写本地知识库。

### Phase 2: Git proposal workflow

```text
kb proposal create
kb commit
kb pr create
kb diff
kb history
```

目标：让个人知识能通过 branch / PR 进入团队知识库。

### Phase 3: Runtime integration

```text
runtime 调用 kb CLI
runtime 持久化 event/tool_call
frontend SSE 展示 agent run timeline
```

目标：让 built-in agent 可以通过前端操作，并使用同一套 kb CLI。

### Phase 4: MCP server

```text
kb mcp-server
runtime MCP client
external agent MCP integration
```

目标：让外部 agent 更结构化地调用 infra 能力。

### Phase 5: Team workflow polish

```text
kb config propose
kb map build/show
kb experiment archive
kb policy hook
Git forge adapters
```

目标：完善团队知识归档与配置变更流程。

---

## 23. 最终架构一句话版

**把 infra 做成“科研知识库 Git CLI”，把 runtime 做成“可持久化 agent session/event engine”。两者通过 process call / MCP 解耦；Git 是知识真源；Postgres 是 agent 行为真源；检索先靠 CLI 的 tree/grep/read/history/diff，而不是 RAG。**

---

## 24. 参考资料

以下资料用于理解当前主流 agent CLI、MCP、前端事件协议和 Git 工作流：

- Lark CLI: https://github.com/larksuite/cli
- MCP specification: https://modelcontextprotocol.io/specification
- MCP transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference
- AG-UI introduction: https://docs.ag-ui.com/introduction
- A2A protocol: https://a2a-protocol.org/latest/
- Git submodules: https://git-scm.com/book/en/v2/Git-Tools-Submodules
- Git worktree: https://git-scm.com/docs/git-worktree
- AGENTS.md guidance: https://developers.openai.com/codex/guides/agents-md
