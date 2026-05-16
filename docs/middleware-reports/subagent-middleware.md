# SubAgentMiddleware / AsyncSubAgentMiddleware 调研笔记

## 1. 总览

DeepAgents 里 subagent 分两类：

- **同步 subagent**：由 `SubAgentMiddleware` 提供 `task` 工具。主 agent 调用 `task(description, subagent_type)` 后会阻塞等待子 agent 完成，子 agent 的最终消息被封装成父 agent 的一条 `ToolMessage`。
- **异步 subagent**：由 `AsyncSubAgentMiddleware` 提供远程后台任务工具。主 agent 调用 `start_async_task` 后立刻拿到 `task_id`，之后通过 `check/update/cancel/list` 操作远程 Agent Protocol / LangGraph server 上的 run。

核心源码：

- `deepagents/libs/deepagents/deepagents/middleware/subagents.py`
- `deepagents/libs/deepagents/deepagents/middleware/async_subagents.py`
- `deepagents/libs/deepagents/deepagents/graph.py`
- 示例：`deepagents/examples/deep_research/agent.py`、`deepagents/examples/async-subagent-server/supervisor.py`、`deepagents/examples/async-subagent-server/server.py`

## 2. 同步 SubAgentMiddleware

### 2.1 入口类和配置类型

同步入口类是 `SubAgentMiddleware`，位于 `middleware/subagents.py`。它接受 `subagents: Sequence[SubAgent | CompiledSubAgent]`，并在初始化时构建一个 `task` 工具。

相关类型：

- `SubAgent`：声明式子 agent 配置，字段包括 `name`、`description`、`system_prompt`，可选 `tools`、`model`、`middleware`、`interrupt_on`、`skills`、`permissions`、`response_format`。
- `CompiledSubAgent`：已编译 runnable 配置，字段包括 `name`、`description`、`runnable`。要求 runnable 的 state schema 至少包含 `messages`，否则无法把结果返回父 agent。
- `GENERAL_PURPOSE_SUBAGENT`：默认 `general-purpose` 子 agent 的基础 spec。

`SubAgentMiddleware.__init__` 做三件事：

1. 校验 subagents 非空。
2. 调 `_get_subagents()` 将每个 spec 转成 `{name, description, runnable}`。
3. 调 `_build_task_tool()` 生成 `task` 工具，并把 `TASK_SYSTEM_PROMPT` 加上可用 subagent 列表后注入 system prompt。

### 2.2 tools

同步 middleware 只暴露一个工具：

- `task`
  - schema：`TaskToolSchema`
  - 参数：`description`、`subagent_type`
  - 同步实现：`task(...)`
  - 异步实现：`atask(...)`

`task` 的工具描述来自 `TASK_TOOL_DESCRIPTION`，会插入可用 agent 列表。描述中强调：适合复杂、多步、可独立并行、需要隔离上下文的任务；不适合简单查询或必须观察中间步骤的任务。

### 2.3 state 处理

同步 subagent 没有新增独立 state schema，但 `_build_task_tool()` 会显式过滤父 state。

被过滤的 key 在 `_EXCLUDED_STATE_KEYS`：

- `messages`
- `todos`
- `structured_response`
- `skills_metadata`
- `skills_load_errors`
- `memory_contents`

调用子 agent 前，`_validate_and_prepare_state()` 从 `runtime.state` 复制非排除字段，并将 `messages` 替换为单条 `HumanMessage(content=description)`。这体现了同步 subagent 的两个关键语义：

- 子 agent 每次调用都是短生命周期、一次性任务。
- 父 agent 的完整对话、todos、skills/memory 私有状态不会直接泄漏给子 agent。

子 agent 返回后，`_return_command_with_state_update()` 要求结果包含 `messages`。它会：

1. 从结果里移除 `_EXCLUDED_STATE_KEYS`。
2. 如果有 `structured_response`，序列化为 JSON 作为返回内容。
3. 否则取 `result["messages"][-1].text.rstrip()` 作为返回内容。
4. 返回 `Command(update={..., "messages": [ToolMessage(content, tool_call_id=...)]})`。

因此父 agent 看到的是一条工具结果，而不是子 agent 的完整执行轨迹。

### 2.4 关键 hook

同步 middleware 的关键 hook 是：

- `SubAgentMiddleware.wrap_model_call(...)`
- `SubAgentMiddleware.awrap_model_call(...)`

它们在模型调用前通过 `append_to_system_message()` 把 `TASK_SYSTEM_PROMPT` 和可用 subagent 列表追加到 system message。

另外，`self.tools = [task_tool]` 是工具注入点。LangChain agent 会把 middleware 暴露的工具合入最终 tool set。

### 2.5 SubAgent 与 CompiledSubAgent 的构建差异

`SubAgentMiddleware._get_subagents()` 分两条路径：

- `CompiledSubAgent`：不重新构建 agent，只对 `runnable` 调 `with_config({"metadata": {"lc_agent_name": name}, "run_name": name})`。这样不会污染原 runnable，也允许同一个 runnable 以多个名字注册。
- `SubAgent`：要求已经有 `model` 和 `tools`。随后调用 LangChain `create_agent(model, system_prompt, tools, middleware, name, response_format)` 构建 runnable。若 spec 有 `interrupt_on`，这里额外追加 `HumanInTheLoopMiddleware`。

注意：`SubAgentMiddleware` 本身不负责为声明式 `SubAgent` 补齐默认 middleware；这个工作在 `create_deep_agent()` 里完成。

## 3. 异步 AsyncSubAgentMiddleware

### 3.1 入口类和配置类型

异步入口类是 `AsyncSubAgentMiddleware`，位于 `middleware/async_subagents.py`。它面向远程 Agent Protocol / LangGraph server。

相关类型：

- `AsyncSubAgent`
  - `name`：异步 agent 类型名。
  - `description`：供主 agent 判断何时委派。
  - `graph_id`：远程 server 上的 graph name 或 assistant id。
  - `url`：远程 Agent Protocol server URL，可选。
  - `headers`：额外请求头，可选。
- `AsyncTask`
  - 保存 `task_id`、`agent_name`、`thread_id`、`run_id`、`status`、`created_at`、`last_checked_at`、`last_updated_at`。

`AsyncSubAgentMiddleware.__init__` 会校验：

- `async_subagents` 非空。
- `name` 不能重复。

随后调用 `_build_async_subagent_tools()` 生成五个工具，并把 `ASYNC_TASK_SYSTEM_PROMPT` 和可用 async subagent 列表追加到 system prompt。

### 3.2 tools

异步 middleware 暴露五个工具：

- `start_async_task`：启动远程后台任务，立即返回 `task_id`。
- `check_async_task`：查询指定任务状态；成功时返回最终结果。
- `update_async_task`：给任务追加新指令，使用同一个 remote thread 创建新 run。
- `cancel_async_task`：取消当前 run。
- `list_async_tasks`：列出本地 state 中追踪的任务，并刷新 live status。

这些工具都由 `StructuredTool.from_function(...)` 创建，并同时提供同步函数和异步 coroutine。

### 3.3 state

异步 middleware 定义了 state schema：

- `AsyncSubAgentState(AgentState)`
- 字段：`async_tasks: Annotated[NotRequired[dict[str, AsyncTask]], _tasks_reducer]`

`_tasks_reducer(existing, update)` 会把新的 task 信息 merge 到旧 dict，因此多个异步任务可以在同一个父 agent state 中累积。注释也明确说明：`async_tasks` 持久化在 agent state 中，可以 survive context compaction/offloading，并可程序化访问。

### 3.4 关键 hook

异步 middleware 的关键 hook 与同步相同：

- `AsyncSubAgentMiddleware.wrap_model_call(...)`
- `AsyncSubAgentMiddleware.awrap_model_call(...)`

它们把 `ASYNC_TASK_SYSTEM_PROMPT` 注入 system message。这个 prompt 特别强调：

- 启动后必须立即把控制权交还用户，不要马上 check。
- 不要循环 poll。
- 历史消息里的状态可能过期，查询状态必须调用工具。
- task_id 必须完整展示。

工具注入点是 `self.tools = _build_async_subagent_tools(async_subagents)`。

## 4. create_deep_agent 的 subagent 分流与装配

`create_deep_agent()` 的 `subagents` 参数支持三类 spec：

- `SubAgent`
- `CompiledSubAgent`
- `AsyncSubAgent`

分流逻辑在 `graph.py:create_deep_agent()`：

1. 初始化两个列表：`inline_subagents` 和 `async_subagents`。
2. 遍历 `subagents or []`：
   - 如果 spec 里有 `graph_id`，视为 `AsyncSubAgent`，加入 `async_subagents`。
   - 如果 spec 里有 `runnable`，视为 `CompiledSubAgent`，原样加入 `inline_subagents`。
   - 否则视为声明式 `SubAgent`，由 `create_deep_agent()` 补齐 `model`、`tools`、`middleware`、`interrupt_on` 等字段后加入 `inline_subagents`。

声明式 `SubAgent` 的默认 middleware stack：

1. `TodoListMiddleware`
2. `FilesystemMiddleware`
3. `create_summarization_middleware(...)`
4. `PatchToolCallsMiddleware`
5. 如果 spec 有 `skills`，追加 `SkillsMiddleware`
6. 追加 spec 自带 `middleware`
7. 追加 subagent model 对应 harness profile 的 extra middleware
8. 如 profile 有 `excluded_tools`，追加 `_ToolExclusionMiddleware`
9. 追加 `AnthropicPromptCachingMiddleware`
10. 应用 profile 的 `excluded_middleware`

声明式 subagent 默认继承父 agent 的：

- `model`：除非 spec 自己提供。
- `tools`：除非 spec 自己提供 `tools`。
- `permissions`：除非 spec 自己提供 `permissions`，提供后替换父规则。
- `interrupt_on`：除非 spec 自己提供 `interrupt_on`。

`CompiledSubAgent` 不继承 top-level middleware 或 HITL；它的行为由传入 runnable 自己决定。

`AsyncSubAgent` 也不继承 top-level middleware、tools、permissions 或 HITL；它只是远程任务入口，真正能力由远程 graph/assistant 定义。

## 5. 默认 general-purpose subagent

如果没有同步 subagent 名为 `general-purpose`，且当前 harness profile 没有禁用默认 general-purpose，`create_deep_agent()` 会自动插入 `GENERAL_PURPOSE_SUBAGENT`。

默认 spec：

- `name`: `general-purpose`
- `description`: 通用研究、文件/内容搜索、多步任务执行；拥有与主 agent 相同工具。
- `system_prompt`: `DEFAULT_SUBAGENT_PROMPT`

默认 general-purpose 的 middleware stack 与普通声明式 subagent 类似：

1. `TodoListMiddleware`
2. `FilesystemMiddleware`
3. `create_summarization_middleware(...)`
4. `PatchToolCallsMiddleware`
5. 如果顶层 `skills` 非空，追加 `SkillsMiddleware`
6. profile extra middleware
7. `_ToolExclusionMiddleware`
8. `AnthropicPromptCachingMiddleware`
9. 应用 profile `excluded_middleware`

它使用主 agent 的 model 和 `_tools`。如果 profile 提供 `general_purpose_subagent.description` 或 `system_prompt`，会覆盖默认描述或 prompt。

最终只要 `inline_subagents` 非空，主 agent middleware stack 中就会加入 `SubAgentMiddleware`，从而暴露 `task` 工具。换句话说，即使用户不传同步 subagent，默认 general-purpose 通常也会让 `task` 工具出现；除非 profile 显式禁用它。

## 6. 主 agent middleware stack 中的位置

`create_deep_agent()` 主 agent 的 base stack 顺序：

1. `TodoListMiddleware`
2. `SkillsMiddleware`，如果顶层 `skills` 存在
3. `FilesystemMiddleware`
4. `SubAgentMiddleware`，如果 `inline_subagents` 非空
5. `create_summarization_middleware(...)`
6. `PatchToolCallsMiddleware`
7. `AsyncSubAgentMiddleware`，如果 `async_subagents` 非空

然后追加用户传入 `middleware`，再追加 profile extra middleware、工具排除、prompt caching、memory、HITL。

这个顺序值得注意：

- 同步 `task` 在 summarization 之前注入，因此主 agent 能在压缩逻辑前看到 task 工具说明。
- 异步工具在 `PatchToolCallsMiddleware` 之后加入，但仍在用户 middleware 之前。
- `SubAgentMiddleware` 属于 required scaffolding，profile 不能把它排除掉；`AsyncSubAgentMiddleware` 则可以被 profile 排除。

## 7. 同步任务调用和返回路径

同步调用链：

1. 主 agent 的模型看到 `TASK_SYSTEM_PROMPT` 和 `task` 工具。
2. 模型发出 tool call：`task(description=..., subagent_type=...)`。
3. `task` 校验 `subagent_type` 是否存在，并要求 `runtime.tool_call_id` 存在。
4. `_validate_and_prepare_state()` 复制父 state 的非私有/非冲突字段，把 `messages` 替换为单条任务描述。
5. 构造 `subagent_config`，带上父 config 的 configurable，并设置 `ls_agent_type="subagent"`。
6. 调用 `subagent.invoke(...)` 或 `subagent.ainvoke(...)`。
7. 子 agent 独立跑自己的模型、工具和 middleware。
8. `_return_command_with_state_update()` 抽取 `structured_response` 或最后一条 message。
9. 返回 `Command(update={"messages": [ToolMessage(...)]})`，并合并允许回传的其他 state 字段。
10. 父 agent 得到工具结果后继续总结、整合并回复用户。

这条路径的核心设计是“隔离执行，压缩返回”：父 agent 不消费子 agent 的完整中间轨迹，只消费一条最终结果。

## 8. 远程 Agent Protocol 异步任务流程

异步 subagent 使用 LangGraph SDK client。`_ClientCache` 按 `(url, headers)` 缓存 sync/async client。`_resolve_headers()` 默认补 `x-auth-scheme: langsmith`，自托管 server 可通过 spec.headers 覆盖。

### 8.1 start_async_task

函数：`_build_start_tool()` 内的 `start_async_task` / `astart_async_task`。

流程：

1. 校验 `subagent_type` 是否在 `agent_map`。
2. 获取 client：同步路径要求 spec 有 `url`；异步路径可用 SDK 的 async client。
3. `client.threads.create()` 创建远程 thread。
4. `client.runs.create(thread_id=..., assistant_id=spec["graph_id"], input={"messages": [{"role": "user", "content": description}]})` 创建 run。
5. 用 `thread_id` 作为本地 `task_id`。
6. 写入 `AsyncTask(status="running")`。
7. 返回 `Command(update={"messages": [ToolMessage("Launched async subagent. task_id: ...")], "async_tasks": {task_id: task}})`。

### 8.2 check_async_task

函数：`_build_check_tool()` 内的 `check_async_task` / `acheck_async_task`。

流程：

1. `_resolve_tracked_task()` 从 `runtime.state["async_tasks"]` 找任务。
2. `client.runs.get(thread_id=..., run_id=...)` 获取 run 状态。
3. 如果 status 是 `success`，再 `client.threads.get(thread_id=...)` 取 thread values。
4. `_build_check_result()` 返回 `{status, thread_id}`，成功时加最后一条 message content 作为 `result`，失败时加 `error`。
5. `_build_check_command()` 更新 `async_tasks[task_id].status/last_checked_at/last_updated_at`，并写一条 JSON ToolMessage。

### 8.3 update_async_task

函数：`_build_update_tool()` 内的 `update_async_task` / `aupdate_async_task`。

流程：

1. 从 state 找 tracked task。
2. 找到对应 `AsyncSubAgent` spec。
3. 在同一个远程 thread 上创建新 run：
   - `thread_id=tracked["thread_id"]`
   - `assistant_id=spec["graph_id"]`
   - `input={"messages": [{"role": "user", "content": message}]}`
   - `multitask_strategy="interrupt"`
4. 本地 task_id 不变，但 `run_id` 更新为新 run，`status` 改回 `running`。
5. 返回确认 ToolMessage 并更新 `async_tasks`。

语义上，update 是“同一任务线程内打断当前 run 并重跑”，不是创建新 task。

### 8.4 cancel_async_task

函数：`_build_cancel_tool()` 内的 `cancel_async_task` / `acancel_async_task`。

流程：

1. 从 state 找 tracked task。
2. 调远程 `client.runs.cancel(thread_id=..., run_id=...)`。
3. 本地状态更新为 `cancelled`。
4. 返回确认 ToolMessage 并更新 `async_tasks`。

示例 server 里 `cancel` 只是把数据库 run 标成 cancelled；真实平台是否能中断执行取决于远程实现。

### 8.5 list_async_tasks

函数：`_build_list_tasks_tool()` 内的 `list_async_tasks` / `alist_async_tasks`。

流程：

1. 从 `runtime.state["async_tasks"]` 取全部任务。
2. `_filter_tasks()` 先按本地 cached status 过滤。
3. 对非 terminal status 调远程 `runs.get(...)` 获取 live status；terminal status 包括 `cancelled`、`success`、`error`、`timeout`、`interrupted`。
4. 生成多行列表：`task_id / agent / status`。
5. 将 live status merge 回 `async_tasks`。

注意：过滤依据是 cached status，然后再刷新 live status。这意味着如果筛选 `running`，一个 cached running 任务刷新后可能显示为 success。

## 9. examples 中的 subagent 配置

### 9.1 deep_research 同步 subagent

`deepagents/examples/deep_research/agent.py` 定义了一个同步 `research_sub_agent`：

- `name`: `research-agent`
- `description`: 要求 orchestrator 一次只给一个 topic。
- `system_prompt`: `RESEARCHER_INSTRUCTIONS.format(date=current_date)`
- `tools`: `[tavily_search, think_tool]`

随后：

```python
agent = create_deep_agent(
    model=model,
    tools=[tavily_search, think_tool],
    system_prompt=INSTRUCTIONS,
    subagents=[research_sub_agent],
)
```

`research_agent/prompts.py` 的 orchestrator prompt 明确要求：

- 先写 todo。
- 保存研究请求。
- 研究阶段始终通过 `task()` 委派给 sub-agent。
- 对比较类或独立方面才并行，多数查询倾向单 subagent。

这是同步 subagent 的典型用法：主 agent 负责规划和综合，子 agent 负责封闭研究任务。

### 9.2 async-subagent-server 异步 subagent

`deepagents/examples/async-subagent-server/supervisor.py` 定义：

```python
async_subagents: list[AsyncSubAgent] = [
    {
        "name": "researcher",
        "description": "A research agent that investigates any topic using web search...",
        "graph_id": "researcher",
        "url": RESEARCHER_URL,
        "headers": {"x-auth-scheme": "custom"},
    },
]
```

然后将它传给 `create_deep_agent(..., subagents=async_subagents)`。supervisor 的 system prompt 手动强化五类操作：start、check、update、cancel、list，并要求永远不要报告 stale status。

`server.py` 实现了一组最小 Agent Protocol 风格接口：

- `POST /threads`：创建 thread。
- `POST /threads/{thread_id}/runs`：创建 run；`multitask_strategy="interrupt"` 时取消旧 run 并清理 thread state。
- `GET /threads/{thread_id}/runs/{run_id}`：查询 run 状态。
- `GET /threads/{thread_id}`：取 thread state，`values["messages"]` 里保存结果。
- `POST /threads/{thread_id}/runs/{run_id}/cancel`：取消 run。

这与 `AsyncSubAgentMiddleware` 的五个工具调用路径一一对应。

## 10. 重要源码路径和类/函数索引

同步 subagent：

- `deepagents/libs/deepagents/deepagents/middleware/subagents.py`
- `SubAgent`
- `CompiledSubAgent`
- `GENERAL_PURPOSE_SUBAGENT`
- `TaskToolSchema`
- `_build_task_tool`
- `_return_command_with_state_update`
- `_validate_and_prepare_state`
- `SubAgentMiddleware`
- `SubAgentMiddleware._get_subagents`
- `SubAgentMiddleware.wrap_model_call`
- `SubAgentMiddleware.awrap_model_call`

异步 subagent：

- `deepagents/libs/deepagents/deepagents/middleware/async_subagents.py`
- `AsyncSubAgent`
- `AsyncTask`
- `AsyncSubAgentState`
- `_tasks_reducer`
- `_ClientCache`
- `_build_async_subagent_tools`
- `_build_start_tool`
- `_build_check_tool`
- `_build_update_tool`
- `_build_cancel_tool`
- `_build_list_tasks_tool`
- `AsyncSubAgentMiddleware`
- `AsyncSubAgentMiddleware.wrap_model_call`
- `AsyncSubAgentMiddleware.awrap_model_call`

装配入口：

- `deepagents/libs/deepagents/deepagents/graph.py`
- `create_deep_agent`
- `_apply_tool_description_overrides`
- `_harness_profile_for_model`
- `_apply_profile_prompt`
- `_apply_excluded_middleware`
- `_verify_excluded_middleware_coverage`

示例和测试：

- `deepagents/examples/deep_research/agent.py`
- `deepagents/examples/deep_research/research_agent/prompts.py`
- `deepagents/examples/async-subagent-server/supervisor.py`
- `deepagents/examples/async-subagent-server/server.py`
- `deepagents/libs/deepagents/tests/unit_tests/test_subagents.py`
- `deepagents/libs/deepagents/tests/unit_tests/test_async_subagents.py`
- `deepagents/libs/deepagents/tests/unit_tests/test_end_to_end.py`

## 11. 学习建议

推荐读源码顺序：

1. 先读 `graph.py:create_deep_agent()` 的参数文档和 middleware stack 注释，建立全局装配图。
2. 读 `create_deep_agent()` 中 `for spec in subagents or []` 的分流逻辑，弄清 `SubAgent`、`CompiledSubAgent`、`AsyncSubAgent` 如何分类。
3. 读默认 `general-purpose` 插入逻辑，理解为什么不传 subagents 时通常也会有 `task` 工具。
4. 读 `subagents.py` 的 `SubAgentMiddleware.__init__`、`_get_subagents()`、`_build_task_tool()`，跟完同步调用链。
5. 读 `async_subagents.py` 的 `AsyncSubAgentState`、`_ClientCache`、五个 `_build_*_tool()`，跟完远程任务生命周期。
6. 对照 `deep_research` 示例看同步委派如何写 prompt。
7. 对照 `async-subagent-server` 示例看 Agent Protocol server 最小接口如何被 SDK 调用。
8. 最后读 `test_subagents.py`、`test_async_subagents.py`、`test_end_to_end.py`，确认边界行为和设计意图。

关键问题清单：

- 为什么同步 subagent 调用前要过滤 `messages/todos/structured_response/skills/memory`？
- `structured_response` 返回时为什么优先于最后一条 message？
- `CompiledSubAgent` 为什么必须包含 `messages` state？
- `CompiledSubAgent` 为什么用 `with_config` 而不是直接改 runnable？
- 默认 `general-purpose` 什么时候会被插入，什么时候会被禁用或覆盖？
- 声明式 `SubAgent` 哪些配置继承父 agent，哪些不会继承？
- 同步 subagent 的 middleware stack 和主 agent stack 有哪些差异？
- `task` 工具返回的 `Command` 如何影响父 agent state？
- 异步任务为什么用 `thread_id` 作为 `task_id`？
- `update_async_task` 为什么用 `multitask_strategy="interrupt"`？
- `list_async_tasks` 为什么先按 cached status 过滤再拉 live status？
- 为什么 async prompt 强调不能自动 check、不能循环 poll、不能相信历史状态？
- 远程 server 的 `values["messages"]` 格式如果不符合预期，`check_async_task` 会如何表现？

## 12. 一句话模型

同步 `SubAgentMiddleware` 是“把一次复杂任务封装成一次阻塞的 `task` 工具调用，并只把最终答案压回主线程”；异步 `AsyncSubAgentMiddleware` 是“把远程 Agent Protocol run 变成本地可追踪的后台任务表，并通过五个工具管理任务生命周期”。
