# CLI / REPL / Deploy Middleware 调研报告

本文聚焦 DeepAgents 在产品入口层额外加上的 middleware：CLI 运行时模型切换、token 状态、交互式提问、本地上下文探测、shell allow-list、部署态 sandbox skills 同步，以及独立 REPL 包提供的 `repl` tool。它们大多不属于 SDK 默认栈，而是在 CLI、REPL、deploy graph factory 中作为“用户 middleware”传入 `create_deep_agent()`。

## 关键源码路径

- `deepagents/libs/cli/deepagents_cli/agent.py`
  - `create_cli_agent()`
  - `ShellAllowListMiddleware`
  - `_add_interrupt_on()`
  - `get_system_prompt()`
  - `build_model_identity_section()`
- `deepagents/libs/cli/deepagents_cli/configurable_model.py`
  - `ConfigurableModelMiddleware`
  - `_apply_overrides()`
  - `_is_anthropic_model()`
- `deepagents/libs/cli/deepagents_cli/token_state.py`
  - `TokenTrackingState`
  - `TokenStateMiddleware`
- `deepagents/libs/cli/deepagents_cli/ask_user.py`
  - `AskUserMiddleware`
  - `_validate_questions()`
  - `_parse_answers()`
- `deepagents/libs/cli/deepagents_cli/local_context.py`
  - `LocalContextMiddleware`
  - `build_detect_script()`
  - `DETECT_CONTEXT_SCRIPT`
  - `_ExecutableBackend`
  - `_AsyncExecutableBackend`
- `deepagents/libs/cli/deepagents_cli/deploy/templates.py`
  - `DEPLOY_GRAPH_TEMPLATE`
  - generated `SandboxSyncMiddleware`
  - generated `make_graph()`
- `deepagents/libs/repl/langchain_repl/middleware.py`
  - `ReplMiddleware`
  - `_create_repl_tool()`
  - `_run_interpreter()` / `_arun_interpreter()`
  - `_build_external_functions()`
- SDK 对照入口：
  - `deepagents/libs/deepagents/deepagents/graph.py:create_deep_agent()`

## 总体栈关系

CLI 入口不是直接使用 SDK 默认 agent，而是先在 `create_cli_agent()` 中构造一组 `agent_middleware`，再把它作为 `middleware=` 参数传给 SDK 的 `create_deep_agent()`。

CLI 侧组装顺序大致是：

1. `ConfigurableModelMiddleware`
2. `TokenStateMiddleware`
3. 可选 `AskUserMiddleware`
4. 可选 CLI 自己的 `MemoryMiddleware`
5. 可选 CLI 自己的 `SkillsMiddleware`
6. local 或 sandbox backend 选择
7. 可选 `LocalContextMiddleware`
8. 可选 `ShellAllowListMiddleware`
9. `create_summarization_tool_middleware(...)`

随后 `agent.py:create_cli_agent()` 调用 SDK：

```python
create_deep_agent(
    model=model,
    system_prompt=system_prompt,
    tools=tools,
    backend=composite_backend,
    middleware=agent_middleware,
    interrupt_on=interrupt_on,
    checkpointer=checkpointer,
    subagents=all_subagents or None,
)
```

关键点在 SDK 的 `graph.py:create_deep_agent()`：传入的 `middleware` 会插入在 SDK 基础栈之后、profile/tail 栈之前。也就是：

1. SDK base stack：`TodoListMiddleware`、可选 SDK `SkillsMiddleware`、`FilesystemMiddleware`、可选 `SubAgentMiddleware`、`SummarizationMiddleware`、`PatchToolCallsMiddleware`、可选 `AsyncSubAgentMiddleware`
2. CLI / 用户传入 `middleware`
3. profile `extra_middleware`
4. 可选 `_ToolExclusionMiddleware`
5. `AnthropicPromptCachingMiddleware`
6. 可选 SDK `MemoryMiddleware`
7. 可选 `HumanInTheLoopMiddleware`

因此，CLI middleware 的位置有两个重要后果：

- 它们能看到 SDK 已注入的工具和 state schema，例如 `execute`、filesystem tools、summarization state。
- 它们早于 SDK tail 的 prompt cache、HITL，因此 `ConfigurableModelMiddleware` 可以在 prompt caching 前切换模型，`ShellAllowListMiddleware` 可以在 tool call 到达实际工具执行前拦截。

需要注意：CLI 侧 `MemoryMiddleware` / `SkillsMiddleware` 是通过 `middleware=` 显式传入的，不是 SDK `memory=` / `skills=` 参数触发的默认 tail/base middleware。CLI 这样做是为了使用本地 `~/.deepagents`、`.agents`、项目目录等多来源规则，并控制 source precedence。

## Middleware 职责

### ConfigurableModelMiddleware

位置：`deepagents_cli/configurable_model.py`。

职责是在每次模型调用前读取 `request.runtime.context` 中的 CLI runtime context，支持不重新编译 graph 的模型切换和参数覆盖。

核心逻辑在 `_apply_overrides()`：

- 从 `runtime.context` 读取 `model`。
- 如果新模型与当前 `request.model` 不匹配，调用 `deepagents_cli.config.create_model()` 解析模型 spec。
- 从 `runtime.context` 读取 `model_params`，浅合并到 `request.model_settings`。
- 当从 Anthropic 切到非 Anthropic 模型时，移除 `cache_control` 等 provider-specific settings，避免 OpenAI 等 provider 报参数错误。
- 如果 system prompt 中存在 `### Model Identity` section，用 `build_model_identity_section()` 重写模型名、provider、context limit、unsupported modalities。
- 最后通过 `request.override(...)` 生成新的 model request。

它实现的是 `wrap_model_call()` / `awrap_model_call()`，所以只影响模型请求，不注入 tool，也不扩展 state。

### TokenStateMiddleware

位置：`deepagents_cli/token_state.py`。

这是一个 schema-only middleware：`TokenTrackingState` 在 agent state 中声明私有字段 `_context_tokens`，`TokenStateMiddleware.state_schema = TokenTrackingState`。

字段语义：

- `_context_tokens` 是 checkpointed state，跨 session 保留。
- 它标记为 `PrivateStateAttr`，不会传给模型。
- CLI 在 LLM response 或 context offload 后写入最新 token 计数，恢复线程时可立即显示 `/tokens` 和 status bar。

它不实现 hook，不改 model request，不注入 tool。它的价值是把 CLI UI 需要的 token 元数据注册进 LangGraph state schema。

### AskUserMiddleware

位置：`deepagents_cli/ask_user.py`。

职责是为交互式 CLI 提供 `ask_user` 工具，让 agent 在执行中暂停并向用户提问。

初始化时它做两件事：

- 用 `@tool` 定义内部 `_ask_user(...)`，并把 `self.tools = [_ask_user]`。
- 在模型调用前把 `ASK_USER_SYSTEM_PROMPT` 注入 system message，告诉模型何时使用 `ask_user`。

工具调用路径：

1. 模型选择调用 `ask_user`，参数是 `questions: list[Question]`。
2. `_validate_questions()` 校验问题列表、类型、choices。
3. `_ask_user()` 构造 `AskUserRequest(type="ask_user", questions=..., tool_call_id=...)`。
4. 调用 LangGraph `interrupt(ask_request)` 暂停 graph。
5. CLI adapter 捕获 `__interrupt__`，识别 `value["type"] == "ask_user"`，挂起等待 UI。
6. Textual app 通过 `_request_ask_user()` 挂载 `AskUserMenu`，用户回答或取消。
7. adapter 构造 `Command(resume={interrupt_id: {"answers": [...]}})` 或带 `status=cancelled/error` 的 payload 继续 graph。
8. `_parse_answers()` 把 resume payload 转为 `ToolMessage`，写回 `messages`，模型下一步即可读到 Q/A。

这个 middleware 只在交互式 CLI 中启用。非交互式路径会传 `enable_ask_user=False`，避免 headless 任务停住等待用户。

### LocalContextMiddleware

位置：`deepagents_cli/local_context.py`。

职责是探测当前执行环境，并把“本地/沙箱上下文”追加到 system prompt，包括 cwd、语言/项目类型、包管理器、runtime 版本、git 状态、测试命令、文件列表、tree、Makefile 摘要，以及 MCP server/tool 列表。

设计重点：

- 探测逻辑不是在 CLI 进程本地直接跑，而是通过 backend 执行 `DETECT_CONTEXT_SCRIPT`。
- backend 可以是 `LocalShellBackend`，也可以是支持 `aexecute()` 的远端 sandbox；因此探测结果反映 agent 真正执行命令和文件操作的环境。
- `LocalContextState` 增加 `local_context` 和私有字段 `_local_context_refreshed_at_cutoff`。
- `before_agent()` / `abefore_agent()` 在第一次 agent run 前执行探测并写入 state。
- 如果 state 中出现 summarization middleware 写入的 `_summarization_event`，且 cutoff 尚未刷新，则重新探测，捕捉会话中环境变化。
- `wrap_model_call()` / `awrap_model_call()` 从 state 读取 `local_context`，和初始化时格式化好的 MCP context 一起追加到 `request.system_prompt`。

它的调用路径是：

`create_cli_agent()` 选择 backend -> 如果 backend 实现 `_ExecutableBackend` 或 `_AsyncExecutableBackend`，加入 `LocalContextMiddleware` -> agent run 前 hook 执行 shell detection script -> state 保存 `local_context` -> 模型调用前追加上下文。

### ShellAllowListMiddleware

位置：`deepagents_cli/agent.py`。

职责是在非交互式或 shell-only gate 场景中，用 allow-list 同步拦截 shell tool call，避免 LangGraph HITL interrupt/resume 造成 LangSmith trace 被拆成多段。

核心逻辑：

- 构造时要求 `allow_list` 非空，且不能是 `SHELL_ALLOW_ALL` sentinel。
- `wrap_tool_call()` / `awrap_tool_call()` 在 tool 执行前调用 `_validate_tool_call()`。
- 仅处理 `SHELL_TOOL_NAMES` 内的工具，一般是 `execute` 这类 shell 工具。
- 从 tool args 读取 `command`，调用 `is_shell_command_allowed(command, self._allow_list)`。
- 允许则调用下游 handler。
- 拒绝则直接返回 `status="error"` 的 `ToolMessage`，graph 不暂停。

CLI 装配逻辑：

- 非交互式入口根据 `settings.shell_allow_list` 判断：
  - shell 禁用或 unrestricted：`auto_approve=True`
  - restrictive allow-list：`interrupt_shell_only=True`，并把 concrete list 传给 server subprocess
- `create_cli_agent()` 收到 `interrupt_shell_only=True` 且非 `auto_approve` 后，生成 `restrictive_shell_allow_list`。
- 该 middleware 会同时加到主 agent 和 filesystem 加载的 subagent；如果没有自定义 `general-purpose` subagent，还会为默认 `general-purpose` spec 注入同样 middleware。
- 一旦主 agent 加入 `ShellAllowListMiddleware`，`interrupt_on` 被设为 `{}`，即关闭 SDK tail 的 `HumanInTheLoopMiddleware` 审批，由 allow-list inline 决策。

### SandboxSyncMiddleware

位置：`deepagents_cli/deploy/templates.py` 中的 `DEPLOY_GRAPH_TEMPLATE`。这是部署时生成到 `deploy_graph.py` 的 middleware，不是源码包里直接 import 的运行时代码。

职责是在 LangGraph deploy 中，把 store/hub 中的 skills 文件同步到真实 sandbox filesystem，使脚本类 skill 能在 sandbox 内被读取和执行。

部署态背景：

- generated graph 使用 `CompositeBackend`。
- default backend 是 sandbox。
- `/memories/`、`/memories/skills/`、`/memories/user/` 等路径路由到 `StoreBackend` 或 `ContextHubBackend`。
- `create_deep_agent(..., skills=[SKILLS_PREFIX])` 让 SDK `SkillsMiddleware` 从 `/memories/skills/` 读取 skill。
- 但是某些 skill 运行时可能需要文件真实存在于 sandbox filesystem，所以需要额外同步。

调用路径：

1. generated `make_graph()` 根据 `assistant_id`、`user_id` 构造 `backend_factory`。
2. 先 seed memories/skills 到 store 或 hub。
3. 调用 `create_deep_agent(..., backend=backend_factory, skills=[SKILLS_PREFIX], middleware=[SandboxSyncMiddleware(...)])`。
4. `SandboxSyncMiddleware.abefore_agent()` 在 agent run 前解析 backend。
5. 确认 backend 是 `CompositeBackend`，且 `backend.default` 是 `SandboxBackendProtocol`。
6. 用 `backend.als(source)` 递归收集 skill files。
7. 用 `backend.adownload_files(paths)` 从 routed store/hub 下载内容。
8. 用 `sandbox.aupload_files(files_to_upload)` 上传到 sandbox。
9. 用 `id(sandbox)` 做进程内去重，同一个 sandbox 实例只同步一次。

它的 `wrap_model_call()` / `awrap_model_call()` 是 pass-through，主要工作发生在 `abefore_agent()`。

### ReplMiddleware

位置：`deepagents/libs/repl/langchain_repl/middleware.py`。

职责是给 agent 注入一个无持久状态的小型 imperative REPL 工具 `repl`，用于小计算、集合处理、分支、循环，以及批量调用注册的 foreign functions。

构造参数：

- `ptc`: 可暴露给 REPL 的 Python callable 或 `BaseTool` 列表。
- `add_ptc_docs`: 是否把 foreign function 文档渲染到 prompt。
- `max_concurrency`: 控制 REPL 内 `parallel([...])` 的并发度。

工作方式：

- `__init__()` 调用 `_create_repl_tool()`，设置 `self.tools = [repl_tool]`。
- `wrap_model_call()` / `awrap_model_call()` 把 `REPL_SYSTEM_PROMPT` 追加到 system message。
- `repl` tool 接收 `code` 和 injected `ToolRuntime`。
- 同步路径调用 `_run_interpreter()`，异步路径调用 `_arun_interpreter()`。
- 每次 tool call 都创建新的 `Interpreter(...)`，所以 REPL 不保留跨调用变量状态。
- `_build_external_functions()` 把 `ptc` 中的 callable/BaseTool 映射为 REPL 可调用函数。
- 如果 foreign `BaseTool` 需要 injected `runtime` 参数，middleware 会用 `_wrap_tool_for_repl()` 包装，构造 payload 并把 `runtime` 注入进去。
- 执行结果优先返回 `print(...)` 输出；如果没有打印，则返回最终表达式值；异常被转成 `Error: ...` 字符串。

这个 middleware 是独立 REPL 包能力，通常由使用方传入 `create_deep_agent(middleware=[ReplMiddleware(...)])`，或在示例/实验 agent 中组合使用。

## 重点调用路径

### CLI 创建 agent 与 SDK 默认栈合并

路径：

`deepagents_cli.main` / `non_interactive` / `server_graph` -> `create_cli_agent()` -> SDK `create_deep_agent()` -> LangChain `create_agent()`。

具体过程：

1. 交互式 CLI 在 `main.py` 中准备 `server_kwargs`，`enable_ask_user=True`，并让 server 使用完整 HITL；`-y` 这类自动审批在客户端 adapter 中处理。
2. 非交互式 CLI 在 `non_interactive.py` 中禁用 `ask_user`，并根据 shell allow-list 选择 `auto_approve` 或 `interrupt_shell_only`。
3. server subprocess 在 `server_graph.py:make_graph()` 读取 `ServerConfig`，调用 `create_cli_agent()`。
4. `create_cli_agent()` 建立 CLI middleware list，建立 local/sandbox backend 和 `CompositeBackend`。
5. `create_cli_agent()` 把 `agent_middleware` 作为 `middleware=` 传给 SDK `create_deep_agent()`。
6. SDK `create_deep_agent()` 先建 base stack，再 `deepagent_middleware.extend(middleware)`，最后追加 profile、prompt cache、SDK memory、HITL tail。

结论：CLI middleware 并不是覆盖 SDK 默认栈，而是作为“用户 middleware 段”嵌入默认栈中间。

### 交互式提问 ask_user

路径：

`AskUserMiddleware.tools` -> `ask_user` tool -> `interrupt(AskUserRequest)` -> `textual_adapter` 捕获 interrupt -> `DeepAgentsApp._request_ask_user()` 挂载 `AskUserMenu` -> 用户提交 -> `Command(resume=...)` -> `_parse_answers()` -> `ToolMessage`。

关键点：

- `ask_user` 是一个真正暴露给模型的 tool，不是普通 UI shortcut。
- pause/resume 由 LangGraph interrupt 机制承载。
- 回答不是直接塞给模型，而是转换成对应 `tool_call_id` 的 `ToolMessage`，保持 tool call / tool result 协议完整。
- cancelled/error 也会显式写成 tool result，避免模型误以为用户给了有效答案。

### 本地上下文探测

路径：

`create_cli_agent()` 选择 backend -> `LocalContextMiddleware.before_agent()` / `abefore_agent()` -> backend `execute()` / `aexecute()` 跑 `DETECT_CONTEXT_SCRIPT` -> 写入 `state["local_context"]` -> `wrap_model_call()` 追加到 system prompt。

关键点：

- 探测脚本在 agent 的 backend 环境中运行，不一定是 CLI 进程环境。
- 第一次运行和 summarization 后都会触发探测。
- MCP server/tool 摘要不是脚本探测来的，而是初始化 middleware 时通过 `_build_mcp_context()` 生成，随后和 `local_context` 一起注入 prompt。

### Shell allow-list

路径：

非交互式 `settings.shell_allow_list` -> `server_session(... interrupt_shell_only=True, shell_allow_list=[...])` -> `create_cli_agent()` -> 主 agent/subagent 注入 `ShellAllowListMiddleware` -> SDK `HumanInTheLoopMiddleware` 不启用或空配置 -> tool call 前 inline validate -> allow 执行 / reject 返回 error `ToolMessage`。

关键点：

- 它的目标不是交互审批，而是 headless 场景中的安全自动执行。
- 和 HITL 是二选一路径：allow-list middleware 生效时，`interrupt_on={}`。
- 拒绝命令仍然以 tool result 形式回到模型，让模型可以改用允许命令或另想办法。

### REPL tool

路径：

使用方 `middleware=[ReplMiddleware(ptc=[...])]` -> SDK 默认栈后插入 `ReplMiddleware` -> model request 前追加 REPL prompt -> 模型调用 `repl(code=...)` -> `StructuredTool` 调用 `_sync_repl` / `_async_repl` -> 新建 `Interpreter` -> 执行 code -> 返回 print 输出或表达式值。

关键点：

- REPL 每次调用从空环境开始，不持久化变量。
- foreign functions 来自 `ptc`，可以是普通 callable，也可以是 LangChain `BaseTool`。
- 对 `BaseTool` 的 injected args 有专门处理，避免模型/REPL 用户手动传 injected runtime 参数。

### Sandbox skills sync

路径：

`deepagents deploy` 生成 `deploy_graph.py` -> `make_graph()` seed store/hub -> `create_deep_agent(skills=[SKILLS_PREFIX], middleware=[SandboxSyncMiddleware(...)])` -> `abefore_agent()` -> 从 `/memories/skills/` routed backend 下载 skill files -> 上传到 sandbox default backend。

关键点：

- `SkillsMiddleware` 负责把 skills catalog 暴露给模型。
- `SandboxSyncMiddleware` 负责把同一批 skill 文件落到 sandbox filesystem。
- 两者共同解决 deploy 环境中“metadata 在 store/hub，执行在 sandbox”的跨 backend 问题。

## 学习建议

### 推荐读源码顺序

1. `deepagents/libs/deepagents/deepagents/graph.py:create_deep_agent()`：先记住默认栈和用户 middleware 插入点。
2. `deepagents/libs/cli/deepagents_cli/agent.py:create_cli_agent()`：看 CLI 如何构造 `agent_middleware`、backend、`interrupt_on`、subagents。
3. `deepagents/libs/cli/deepagents_cli/configurable_model.py`：理解 runtime context 如何影响 model request。
4. `deepagents/libs/cli/deepagents_cli/token_state.py`：理解 schema-only middleware 的极简形态。
5. `deepagents/libs/cli/deepagents_cli/ask_user.py`，再读 `textual_adapter.py` 的 interrupt/resume 处理和 `app.py:_request_ask_user()`。
6. `deepagents/libs/cli/deepagents_cli/local_context.py`：从 `build_detect_script()` 到 `before_agent()`，再到 `wrap_model_call()`。
7. `deepagents/libs/cli/deepagents_cli/agent.py:ShellAllowListMiddleware`，再读 `non_interactive.py` 中如何决定 `interrupt_shell_only`。
8. `deepagents/libs/repl/langchain_repl/middleware.py`：对照一个 REPL 示例，看 tool 注入和 foreign function 包装。
9. `deepagents/libs/cli/deepagents_cli/deploy/templates.py`：重点读 generated `SandboxSyncMiddleware`、`_build_backend_factory()`、`make_graph()`。

### 关键问题清单

- 一个 middleware 是注入 tool、改写 model request、注册 state schema，还是在 agent run 前更新 state？
- CLI 侧 middleware 为什么通过 `middleware=` 传入，而不是 SDK `memory=` / `skills=` 参数？
- `ConfigurableModelMiddleware` 为什么要放在 CLI middleware list 的最前面？
- 当模型从 Anthropic 切到 OpenAI 时，哪些 provider-specific settings 需要被清理？
- `_context_tokens` 为什么是 `PrivateStateAttr`，而不是普通 state？
- `ask_user` 为什么需要 LangGraph interrupt，而不是直接调用 UI callback？
- `ask_user` 的 cancel/error 如何反馈给模型，是否会破坏 tool call 配对？
- `LocalContextMiddleware` 为什么要通过 backend 执行探测脚本，而不是在 CLI 进程中探测？
- summarization 后为什么需要重新探测 local context？
- `ShellAllowListMiddleware` 和 `HumanInTheLoopMiddleware` 的边界是什么？什么时候启用哪个？
- shell allow-list 为什么要同时注入主 agent 和 subagent？
- deploy 环境下 `/memories/skills/` 路由到 store/hub，为什么还要同步到 sandbox filesystem？
- `SandboxSyncMiddleware` 用 `id(sandbox)` 做同步去重，在 sandbox scope 为 thread/assistant 时分别意味着什么？
- `ReplMiddleware` 为什么显式强调“不跨调用保留状态”？这对模型规划多步 foreign function 调用有什么影响？
- `BaseTool` 暴露给 REPL 时，injected runtime 参数如何安全传递？

## 一句话总结

CLI / REPL / Deploy 侧 middleware 是 DeepAgents SDK 默认栈之上的产品化扩展层：CLI 负责交互、模型切换、本地上下文和 headless shell 安全；REPL 提供可组合的小语言 tool；Deploy 负责把 store/hub 中的 skills 与真实 sandbox 执行环境对齐。理解它们的关键，是始终把它们放回 `create_deep_agent()` 的默认栈合并顺序里看。
