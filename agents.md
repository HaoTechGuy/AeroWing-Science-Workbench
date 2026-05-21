# InternAgents 开发规范

本文档面向参与 InternAgents 开发的人和代码 Agent。目标是让项目在继续接入 DeepAgents SDK、LangGraph、本地工作台、远程 Agent 服务和 SSH 计算资源时，保持边界清晰、升级可控、代码可维护。

## 设计原则

1. DeepAgents SDK 是外部依赖，不是 InternAgents 的内部运行时。优先通过公开 API、backend 适配器、middleware 和资源配置扩展能力。
2. InternAgents 只维护自己的接入层。除非单独做上游补丁，否则不要修改 `deepagents/` 本地 checkout，也不要把对 SDK 私有实现的依赖散落到业务代码里。
3. 远程 Agent 服务和 SSH 计算资源是两种不同概念。前者是已有 LangGraph / InternAgents 服务，UI 直接连接它；后者是 local 通过 SSH 控制的工作环境，由本地服务暴露给当前会话使用。
4. 运行时边界优先于功能堆叠。新增功能先放进清晰的 adapter、service 或 API route，再考虑 UI 呈现；不要把跨进程、跨机器、跨 SDK 的逻辑塞进页面组件或 `agent.py` 的分支里。
5. 配置和密钥默认本地化。仓库只提交示例、默认 local 配置和无敏感信息的说明；真实 IP、用户名、SSH 命令、私钥路径、隧道端口、API Key 必须留在未跟踪的本地文件或环境变量里。

## 当前架构边界

### Python Agent 层

- `agent.py` 是 LangGraph graph 导出入口，负责加载模型、技能、资源配置，并创建 `create_deep_agent(...)` 或 `RemoteGraph` 代理。
- `internagent_resources.py` 是资源配置解析入口，负责把 `internagent.resources.json` 或 `INTERNAGENT_RESOURCES_FILE` 转成 `ResourceConfig`。
- `ssh_backend.py` 是 SSH 工作区 backend 适配器，负责把 DeepAgents filesystem / shell backend 协议映射到固定远端 workspace。
- `kb_sync_middleware.py` 是资源相关 middleware，负责在 agent run 前后做 best-effort KB 同步。
- `deepagent.config.json` 是 agent 行为配置，不应承载机器私有信息。

新增 Python 能力时，先判断它属于哪一层：

- DeepAgents backend 能力：放在独立 backend adapter 中，例如 `ssh_backend.py`。
- Agent 运行前后逻辑：放在 middleware 中，例如 `kb_sync_middleware.py`。
- 资源选择、资源 schema：放在 `internagent_resources.py`，并同步 UI 侧读取逻辑。
- LangGraph graph 组装：只在 `agent.py` 做薄封装，不在这里实现大段远程协议、安装流程或 UI 状态逻辑。

### 运行模式

当前代码区分两类 Python 进程：

- local 主服务：默认 `langgraph.json`，面向 Web UI，导出 `agent`、`agent_local`、`agent_remote1`、`agent_remote2`。
- 资源 runtime：`INTERNAGENT_PROCESS_ROLE=runtime` 搭配 `langgraph.runtime.json`，在具体资源工作区内创建真实 DeepAgent。

`create_agent_for_resource(...)` 在资源有 `remote_url` 时应只代理独立 runtime；只有显式设置 `INTERNAGENT_ALLOW_EMBEDDED_RESOURCE` 时，才允许在主服务进程内直接创建资源 backend。这个限制是为了避免 local 主服务同时承担 UI 投影、远程执行、资源隔离和任务生命周期管理。

### Web UI 层

- `ui/src/lib/remote-agent.ts` 是浏览器侧 LangGraph SDK 的封装点。线程、assistant 解析、stream 参数和 stream event 捕获都应优先在这里收敛。
- `ui/src/lib/config.ts` 管理浏览器可见的 Agent 服务连接配置。
- `ui/src/app/api/workspace/_lib/workspace.ts` 管理工作区文件浏览，并根据资源 backend 决定本地读文件或 SSH 读取。
- `ui/src/app/connect/page.tsx` 当前面向 Agent 服务连接，不应混入 SSH 登录、远程安装或计算资源状态管理。
- `ui/src/app/config/page.tsx` 面向模型、授权、主题等 local 配置，不应直接承载多服务器编排逻辑。

前端新增配置时要分清：

- Agent 服务连接：`deploymentUrl`、`assistantId`、可选 API Key。它表示“浏览器直接连接哪个 LangGraph / InternAgents 服务”。
- 计算资源：SSH host、user、port、key、workspace、runtime URL、状态。它表示“local 可调度哪些工作环境”。

不要把 Agent 服务和计算资源放进同一个下拉菜单或同一份浏览器配置里。用户选择远程 Agent 服务时，工作发生在该远程服务自身环境；用户使用 local 时，local 才能列出并使用它配置的 SSH 计算资源。

## DeepAgents SDK 使用规范

### 允许依赖的接口

优先使用这些稳定接入点：

- `deepagents.create_deep_agent`
- `deepagents.backends.LocalShellBackend`
- `deepagents.backends.protocol` 中的 backend protocol 和返回类型
- LangChain / LangGraph 的 public middleware、message、graph API
- LangGraph SDK 的 `Client` 和服务端 HTTP API

如果必须使用稳定性不明确的接口，应满足两个条件：

1. 只在一个 adapter 文件中引用，例如只在 `ssh_backend.py` 引入 backend protocol 类型。
2. 在 `agents.md` 或相关代码注释中说明原因，并补充升级检查点。

### 禁止事项

- 不要修改或提交 `deepagents/` 目录。该目录在 `.gitignore` 中，只能作为临时本地调试 checkout。
- 不要 monkey patch DeepAgents 或 LangGraph runtime。
- 不要依赖 DeepAgents 内部文件路径、私有类名、私有状态字段或未文档化 tool 名称来实现核心功能。
- 不要把 SDK 返回对象当成普通 dict 随意读写。优先使用 SDK 暴露的类型、方法和协议对象。
- 不要为了绕过 SDK 限制在 UI、API route 和 Python backend 里各写一套不一致的执行逻辑。

### 扩展方式

需要新增文件、命令、远程执行、长任务或资源能力时，按顺序选择扩展点：

1. 能通过 DeepAgents backend protocol 表达的，写新的 backend adapter。
2. 需要在 run 前后注入行为的，写 middleware。
3. 需要跨进程或跨机器常驻状态的，写独立服务或 daemon，再由 adapter/tool 调用。
4. 需要展示状态的，写 Next.js API route 做本地服务代理，前端只消费结构化状态。
5. 确认 SDK 缺少必要扩展点时，再开独立上游补丁，不在业务分支直接改 SDK。

## DeepAgents SDK 升级流程

升级 `deepagents`、`langgraph`、`@langchain/langgraph-sdk` 或相关 runtime 依赖时，必须做以下检查：

1. 阅读对应版本 changelog 或 release notes，重点看 backend protocol、tool name、interrupt、stream mode、RemoteGraph、LocalShellBackend 的变更。
2. 更新依赖版本时只改必要文件，例如 `pyproject.toml`、`requirements.txt`、`ui/package.json`、lockfile。
3. 先跑 Python import smoke test：

```bash
.conda/bin/python -c "import agent; print(agent.MODEL)"
```

4. 检查 DeepAgents backend protocol 是否仍兼容 `ssh_backend.py` 的返回类型。
5. 检查 `create_deep_agent(...)` 参数是否仍兼容 `agent.py`。
6. 检查 Web UI stream 事件是否仍兼容 `ui/src/lib/remote-agent.ts`。
7. 对 UI 改动运行 lint/build；对 Python 改动运行 compile 或测试。
8. 在 PR 或提交说明里写清楚升级影响和验证结果。

如果升级导致 DeepAgents runtime 行为变化，不要直接在各处补丁式修复。先把差异封装进一个兼容层，再让业务代码调用兼容层。

## 远程 Agent 服务和 SSH 计算资源

### 远程 Agent 服务

远程 Agent 服务是已经运行的 LangGraph / InternAgents 服务。UI 通过 `deploymentUrl` 和 `assistantId` 直接访问它。它的工作区、模型、工具、资源由该服务自己负责。

开发要求：

- 连接页只描述和配置 Agent 服务连接。
- 不要在浏览器里拼 SSH 命令或读私钥。
- 不要假设远程 Agent 服务一定由当前 local 安装或控制。
- 切换远程 Agent 服务时，不应展示 local 持有的 SSH 计算资源，除非远程服务显式提供自己的资源列表 API。

### SSH 计算资源

SSH 计算资源是 local 可连接的工作环境，用于在固定 workspace 内执行文件浏览、命令或资源 runtime。它不是浏览器直连对象。

开发要求：

- SSH 配置存放在未跟踪的 `internagent.resources.local.json` 或等价本地配置中。
- 私有资源不要提交进 `internagent.resources.json` 或 `ui/deepagent-ui.config.json`。
- SSH 命令只能由 local 后端执行，不能在浏览器执行。
- 所有远端路径必须限制在配置的 workspace 内。
- 不要为这套能力修改远端服务器的 SSH daemon、firewall、security group、路由或系统级网络配置。
- 如果需要端口转发，应由用户本地 SSH 配置或启动脚本显式建立，并写在本地配置里。

### 自动安装和 daemon

如果后续加入“连接服务器后自动安装远端 backend”或“远端长任务 daemon”，应保持以下边界：

- 安装脚本只负责部署 InternAgents 所需用户态文件、Python 环境和工作目录。
- daemon 只监听远端本机 Unix socket 或用户态端口，不默认开放公网 HTTP 服务。
- daemon 状态文件和日志必须位于远端用户目录或配置的 state dir。
- 本地通过 SSH 调用远端 client 或脚本，不把 daemon 协议暴露给浏览器。
- daemon API 必须返回结构化 JSON，错误信息要可读。
- 长任务 submit、cancel、写文件、执行命令必须继续走 HITL 审批链路。

## 配置和密钥

仓库允许提交：

- `.env.example`
- `deepagent.config.json` 的安全默认值
- `internagent.resources.json` 的 local 默认资源
- `internagent.resources.example.json` 的示例资源
- `ui/deepagent-ui.config.json` 的 local 默认 UI 配置
- README 和文档中的脱敏示例

仓库禁止提交：

- `.env`
- `ui/.env*`
- `internagent.resources.local.json`
- 真实服务器 IP、真实用户名、私钥路径、私有 SSH alias、隧道端口、API Key
- `.internagents/`、`.langgraph_api/`、日志、pid、临时 active skills
- 本地 vendored `deepagents/` checkout

配置 schema 变更时，要同步更新：

- Python 读取逻辑，例如 `internagent_resources.py`
- UI 读取逻辑，例如 `ui/src/lib/config.ts` 或 `ui/src/app/api/workspace/_lib/workspace.ts`
- 示例配置
- README
- 本文档中对应说明

## SSH 和 shell 执行规范

SSH 和 shell 是高风险边界，必须集中处理。

- Python 中优先使用 `subprocess.run([...], shell=False)`。
- 需要解析用户配置的 SSH 命令时，使用 `shlex.split(...)`，并把调用集中在 backend adapter。
- TypeScript 中优先使用 `execFile`；确实需要 shell 时，把 quoting helper 收敛在一个文件里。
- 远端 Python payload 优先通过 JSON + base64 或 argv 传输，不拼接未转义用户输入。
- workspace 内路径必须 normalize，并拒绝 `..`、绝对路径逃逸和 `~` 逃逸。
- 读取工作区时默认隐藏 `.env*`、私钥、runtime 目录、node_modules、缓存目录。
- 输出必须设置 timeout 和 max buffer，避免远端命令卡死或撑爆进程内存。

不要新增第二套 SSH quote、path sanitize 或 workspace traversal 逻辑。需要改动时，优先改现有 helper 并补验证。

## UI 开发规范

UI 需要保留清晰的信息架构：

- 工作台只展示当前对话必要的选择和状态。
- Agent 服务连接页面只处理已有 LangGraph / InternAgents 服务。
- 计算资源管理页面只处理 local 可通过 SSH 控制的资源。
- 模型、授权、主题配置留在配置页。
- 文件浏览只通过 workspace API 读取，不在组件里直接访问本地文件或远端 SSH。

前端代码组织：

- 页面组件负责布局和交互，不承载协议细节。
- LangGraph SDK 调用收敛到 `WebRemoteAgent`。
- 工作区读取收敛到 `ui/src/app/api/workspace/_lib/workspace.ts`。
- 可复用 UI 状态、类型、helper 放入 `ui/src/lib`、`ui/src/app/types` 或组件附近的 `_lib`。
- 新增 API route 必须明确是否只能访问 local 文件系统、是否可能访问远端 SSH、是否会写配置。

当 Agent 服务和计算资源同时存在时，交互规则应是：

- local 是默认 Agent 服务，不需要用户配置。
- 只有当前 Agent 服务是 local 时，才展示 local 管理的 SSH 计算资源。
- 连接到远程 Agent 服务后，local 的 SSH 计算资源列表不参与该会话。
- 如果远程 Agent 服务以后提供自己的资源列表，应通过该服务的 API 获取，并在 UI 上明确标注来源。

## 测试和验证

按改动范围选择验证项。不要只跑和改动无关的轻量命令来替代实际验证。

### 文档或配置变更

```bash
git diff --check
python3 -m json.tool deepagent.config.json >/dev/null
python3 -m json.tool internagent.resources.json >/dev/null
python3 -m json.tool ui/deepagent-ui.config.json >/dev/null
```

### Python agent 或 backend 变更

```bash
.conda/bin/python -m compileall agent.py internagent_resources.py ssh_backend.py kb_sync_middleware.py
.conda/bin/python -c "import agent; print(agent.MODEL)"
```

如果改了 shell 脚本：

```bash
bash -n scripts/dev.sh
```

如果新增远端脚本，也要对新增脚本运行 `bash -n`。

### UI 变更

```bash
npm --prefix ui run lint
npm --prefix ui run build
```

如果改了工作台布局、连接页、配置页或文件浏览，启动 dev server 并用浏览器检查关键路径：

- local 默认工作台可进入
- 连接页可保存并恢复默认
- 配置页可读取和保存
- workspace 文件列表可显示 local resource
- SSH resource 的错误状态可读，不泄露密钥

### 远程资源变更

至少覆盖：

- SSH 不可达时错误可读
- 缺少 `ssh_command` 或 workspace 时错误可读
- workspace 外路径被拒绝
- 短命令能执行并返回 exit code
- 大输出被截断
- timeout 生效
- 私钥、`.env`、runtime 目录不会通过 UI 文件浏览暴露

### DeepAgents SDK 升级

除上面的 Python 和 UI 验证外，还要做一次端到端 smoke test：

1. 启动 local runtime 和主服务。
2. 打开 UI，发送一条只读问题。
3. 触发一次文件读取或命令审批。
4. 确认 stream、interrupt、thread history 和 workspace state 正常。

## 提交规范

提交前检查：

- `git status --short` 中没有本地密钥、`.env`、runtime state、日志或 node_modules。
- 新增配置字段有示例、默认值、读取逻辑和文档。
- 新增远程能力没有修改系统网络安全设置。
- 对 DeepAgents / LangGraph 的依赖集中在 adapter 或 provider 中。
- 验证命令的结果写进 PR 描述或提交说明。

提交粒度：

- SDK 升级、UI 交互、SSH backend、配置 schema、文档更新尽量分开提交。
- 不要把临时部署、远端机器调试、格式化全仓库和功能改动混在一起。
- 如果必须触碰多个边界，提交说明要解释为什么这些边界需要一起改。

## 代码健康红线

出现以下情况时应先停下来重构边界，而不是继续堆功能：

- 同一个远程概念在 UI、Next API、Python agent 中各有一套 schema。
- 页面组件里出现 SSH 命令拼接、路径清洗或 LangGraph stream 解析细节。
- `agent.py` 中新增大量与 graph 组装无关的安装、状态轮询或进程管理代码。
- 为了适配 SDK 变化到处加 `try/except` 或字段 fallback。
- 本地默认配置开始包含真实机器、真实账号或隧道端口。
- 同一工具调用同时绕过 HITL 和 backend workspace 限制。

遇到这些信号时，优先抽 adapter、统一 schema、补测试，再继续业务功能。
