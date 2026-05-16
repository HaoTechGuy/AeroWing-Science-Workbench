# DeepAgents Context Management Analysis

本文分析当前仓库中 DeepAgents 的上下文管理机制，重点回答几个问题：

- 哪些信息会进入模型上下文？
- 长期 memory、local context、conversation history 之间是什么关系？
- 什么时候会触发压缩、外置和恢复？
- 这些机制如何和 LangGraph checkpoint、human-in-the-loop、工具调用协同？

相关核心文件：

- `deepagents/libs/deepagents/deepagents/graph.py`
- `deepagents/libs/deepagents/deepagents/middleware/memory.py`
- `deepagents/libs/deepagents/deepagents/middleware/filesystem.py`
- `deepagents/libs/deepagents/deepagents/middleware/summarization.py`
- `deepagents/libs/cli/deepagents_cli/agent.py`
- `deepagents/libs/cli/deepagents_cli/local_context.py`
- `deepagents/libs/cli/deepagents_cli/offload.py`
- `deepagents/libs/cli/deepagents_cli/textual_adapter.py`
- `deepagents/libs/cli/deepagents_cli/app.py`
- `deepagents/libs/cli/deepagents_cli/token_state.py`

## 1. 总体模型

这个项目不是通过一个单独的 `Runtime` 类集中管理上下文，而是把上下文能力拆成多层 middleware，最后交给 LangChain/LangGraph agent runtime 执行。

`create_deep_agent()` 是核心构图入口。它会组装：

- todo list middleware
- skills middleware
- filesystem middleware
- subagent middleware
- summarization middleware
- tool-call patch middleware
- prompt caching middleware
- memory middleware
- human-in-the-loop middleware
- 用户自定义 middleware

最后调用 `create_agent(...)`，并把 `checkpointer`、`store`、`cache` 等运行时能力透传给 LangGraph。

因此，上下文管理可以理解为四类东西的组合：

1. **系统级上下文**：base system prompt、用户 system prompt、profile prompt、工具使用规则。
2. **长期上下文**：`AGENTS.md` / memory。
3. **环境上下文**：local context，包括 cwd、git、文件树、package manager、MCP servers 等。
4. **对话上下文**：message history、tool result、summary、offloaded conversation history。

这些来源最终都会在模型调用前被 middleware 合成到 request 中。

## 2. AGENTS.md / Memory 是否进入上下文

会。

`MemoryMiddleware` 明确做两件事：

1. 在 agent 执行前读取 memory sources。
2. 在每次模型调用前把 memory 内容追加到 system message。

代码位置：

- `memory.py` 的 `before_agent()` / `abefore_agent()` 负责读取 source 文件。
- `memory.py` 的 `modify_request()` 负责注入 system message。

注入格式大致是：

```xml
<agent_memory>
path/to/AGENTS.md
...AGENTS.md content...
</agent_memory>

<memory_guidelines>
...
</memory_guidelines>
```

CLI 默认加载的 memory sources 来自 `create_cli_agent()`：

- 用户级：`~/.deepagents/{assistant_id}/AGENTS.md`
- 项目级：项目根目录的 `.deepagents/AGENTS.md`
- 项目级：项目根目录的 `AGENTS.md`

这些路径会被传给 `MemoryMiddleware(backend=FilesystemBackend(), sources=memory_sources)`。

### 一个重要细节

Memory 被读取后存在 graph state 的 `memory_contents` 字段里，而且这个字段是 private state。private 的意思是它不作为普通 final output 暴露，但仍然是 checkpointed state 的一部分。

`MemoryMiddleware` 读取时有一个短路：

```python
if "memory_contents" in state:
    return None
```

所以在同一个 thread/checkpoint 里，如果外部修改了磁盘上的 `AGENTS.md`，当前 thread 不一定自动重新读取。新 thread 或 state 重建后会加载新的文件内容。

这点容易误解：`AGENTS.md` 是进上下文的，但它不是每个 model call 都重新读磁盘。

## 3. Local Context 是什么

`LocalContextMiddleware` 管理的是当前运行环境快照。它通过 backend 执行一段 detection script，收集本地环境信息，然后把结果追加到 system prompt。

主要包含：

- 当前工作目录
- 项目语言
- git root
- 是否 monorepo
- `.venv`、`node_modules` 等环境目录
- package manager：`uv`、`poetry`、`pip`、`npm`、`pnpm`、`yarn`、`bun`
- runtime：Python / Node 版本
- git 分支、detached HEAD、main/master、dirty changes 数量
- 推测测试命令：`make test`、`pytest`、`npm test`
- 顶层文件列表
- 目录树预览
- Makefile 片段
- MCP server/tool inventory

Local context 的 state 字段是 `local_context`。首次运行时检测一次；如果发生 summarization/offload，`_summarization_event` 变化后会刷新一次 local context，避免压缩后的长期会话继续使用过期的 git/目录环境信息。

## 4. Memory 和 Local Context 的关系

二者是并列关系，不是包含关系。

Memory 关注长期规则：

- 用户偏好
- 项目规范
- 编码风格
- 长期身份/职责
- 需要未来复用的信息

Local context 关注当前现场：

- 当前目录是什么
- 当前分支是什么
- 项目看起来用什么包管理器
- 目录里有哪些文件
- 有哪些 MCP server/tools

它们没有直接互相调用。交互方式是：

1. `MemoryMiddleware` 把 `AGENTS.md` 内容读入 state。
2. `LocalContextMiddleware` 把环境快照读入 state。
3. 每次模型调用前，各自修改 request。
4. 最终模型看到的是合成后的 system prompt。

如果二者冲突，模型会同时看到。通常可以把 AGENTS.md 看作“规则/偏好”，把 local context 看作“当前事实快照”。

例如：

- AGENTS.md 写：“这个项目使用 uv，提交前跑 make test。”
- local context 检测到：“当前目录存在 uv.lock，当前 git branch 是 feature-x，有 3 个未提交变更。”

模型会把两者合并理解。

## 5. 对话上下文和 checkpoint

对话上下文主要保存在 LangGraph state 的 `messages` 中，并通过 `thread_id` 绑定 checkpoint。

CLI 每次执行 agent stream 时都会构造类似配置：

```python
config = {"configurable": {"thread_id": thread_id}}
```

LangGraph checkpointer 用这个 `thread_id` 区分不同会话。CLI 默认使用 SQLite checkpointer：

- `sessions.py` 提供 `get_checkpointer()`
- `server_manager.py` 为 LangGraph dev server 生成 `checkpointer.py`
- `app.py` 恢复 thread 时用 `aget_state(config)` 或直接读取 SQLite checkpoint

这意味着“断点续跑”不是靠重新拼 prompt，而是靠 checkpoint 恢复 state，包括：

- messages
- private state，比如 `_summarization_event`
- private state，比如 `_context_tokens`
- memory contents
- local context

## 6. 什么叫外置

“外置”指的是：某些信息太大，不直接继续留在模型输入上下文里，而是写到 backend 文件中；模型上下文里只保留摘要、预览或路径引用。

这不是说所有上下文都被外置。AGENTS.md / memory 是直接进 system prompt 的。外置主要发生在三类场景：

1. 大工具结果
2. 超大用户消息
3. 对话历史压缩

## 7. 大工具结果外置

`FilesystemMiddleware` 会拦截 tool result。如果工具返回的 `ToolMessage` 太大，会把完整内容写入：

```text
/large_tool_results/{tool_call_id}
```

模型上下文中只保留一个 preview 和文件路径。后续模型如果需要完整内容，可以通过 `read_file` 或 `grep` 再读。

默认阈值：

```python
tool_token_limit_before_evict = 20000
```

这解决的是工具结果膨胀问题，例如：

- `grep` 返回超大结果
- `execute` 输出大量日志
- `read_file` 或外部工具返回大文本

注意：这不是 summarization，它只是把原文移动到 backend，当前上下文里留引用。

## 8. 超大 HumanMessage 外置

`FilesystemMiddleware` 还会处理过大的用户消息。默认阈值：

```python
human_message_token_limit_before_evict = 50000
```

如果最后一条 `HumanMessage` 太大，会把完整文本写入：

```text
/conversation_history/{uuid}.md
```

然后给这条 human message 打上 `lc_evicted_to` 标记，后续模型看到的是一个截断版本和文件路径。

这通常处理用户一次性贴入超大文档、日志、代码块的场景。

这个路径也叫 `conversation_history`，但它和 thread 级 summarization 写入的 `{thread_id}.md` 不是同一种粒度：

- 超大单条消息：`/conversation_history/{uuid}.md`
- 对话历史压缩：`/conversation_history/{thread_id}.md`

## 9. 自动 Summarization

`create_deep_agent()` 默认给主 agent 和 subagent 加 `SummarizationMiddleware`。

这个 middleware 在每次 model call 前工作：

1. 读取原始 messages。
2. 如果已有 `_summarization_event`，先把有效上下文重建成：`summary_message + cutoff 后的新消息`。
3. 对旧消息里的大 tool call args 做轻量截断。
4. 计算 token。
5. 如果达到 trigger，进行 summarization。
6. 把被摘要的旧消息写入 backend。
7. 生成 summary message。
8. 当前 model call 使用 `summary + preserved recent messages`。
9. 通过 `ExtendedModelResponse` 更新 `_summarization_event`。

默认 trigger 来自 `compute_summarization_defaults()`：

- 如果模型 profile 有 `max_input_tokens`：到上下文窗口 85% 触发。
- 如果没有 profile：默认 `170000` tokens 触发。

默认 keep：

- 有 profile：保留上下文窗口 10% 的最近内容。
- 无 profile：保留最近 6 条消息。

如果没有达到 trigger，会正常调用模型。但如果模型抛出 `ContextOverflowError`，会 fallback 到 summarization path，再用压缩后的消息重试。

## 10. conversation_history 什么时候写入

`/conversation_history` 有几条写入路径。

### 10.1 自动 summarization

当 `SummarizationMiddleware` 判断需要压缩时，会把被摘要的旧消息追加到：

```text
/conversation_history/{thread_id}.md
```

每次压缩追加一个 markdown section：

```markdown
## Summarized at 2026-...

...old messages...
```

然后 summary message 中会包含这个 file path：

```text
The full conversation history has been saved to /conversation_history/{thread_id}.md should you need to refer back to it for details.
```

### 10.2 compact_conversation 工具

CLI 会额外注册 `SummarizationToolMiddleware`，给 agent 一个 `compact_conversation` 工具。

这个工具不是自动后台执行，而是普通 tool call。模型可以主动调用它，或者用户流程触发相关命令。

它也会写：

```text
/conversation_history/{thread_id}.md
```

然后更新 `_summarization_event`。

### 10.3 /offload 或 /compact 命令

CLI 命令 `/offload` 和 `/compact` 会走 `app.py` 的 `_handle_offload()`，调用 `perform_offload()`。

这条路径不是让模型决定，而是 UI 命令直接触发。它会：

1. 读取当前 thread state。
2. 用 summarization middleware 的逻辑算 cutoff。
3. 如果没有足够旧消息可压缩，返回 threshold not met。
4. 生成 summary。
5. 把旧消息写入 `/conversation_history/{thread_id}.md`。
6. 更新 state 里的 `_summarization_event`。
7. 持久化 `_context_tokens`。

### 10.4 超大单条用户消息

如上一节所述，超大 `HumanMessage` 会写：

```text
/conversation_history/{uuid}.md
```

这是单条消息外置，不是 summary。

## 11. _summarization_event 是核心

压缩后，系统并不是简单地把 checkpoint 中的旧 messages 物理删除。更关键的是维护一个 private state：

```python
_summarization_event = {
    "cutoff_index": ...,
    "summary_message": ...,
    "file_path": ...,
}
```

后续每次 model call，`SummarizationMiddleware` 会调用 `_apply_event_to_messages()`：

```text
effective_messages = [summary_message] + messages[cutoff_index:]
```

所以 checkpoint 里可以仍然有完整 messages，但模型实际看到的是压缩后的 effective messages。

这带来几个好处：

- checkpoint 中仍有较完整的原始状态。
- 模型上下文被压缩。
- summary 能稳定跨 turn 生效。
- thread resume 后也能继续使用同一个压缩视图。
- local context 可以根据 `_summarization_event` 刷新。

## 12. 主动压缩什么时候启动

这里要区分三种压缩。

### 12.1 自动压缩

`SummarizationMiddleware` 每次 model call 前检查 token。达到 trigger 或遇到 `ContextOverflowError` 时触发。

这是 runtime 自动行为。

### 12.2 agent 主动调用工具

`SummarizationToolMiddleware` 提供 `compact_conversation` 工具，并往 system prompt 里加入提示：

```text
You have access to a compact_conversation tool...
You should use the tool when...
```

模型看到提示后，可能主动调用工具。

不过工具有 eligibility gate：大约达到自动压缩 trigger 的 50% 才允许真正 compact，否则返回：

```text
Nothing to compact yet - conversation is within the token budget.
```

### 12.3 用户手动命令

用户输入：

```text
/offload
/compact
```

CLI 直接执行 `_handle_offload()`。这是用户主动压缩，不依赖模型是否选择调用工具。

## 13. tool call args 轻量截断

在完整 summarization 前，还有一个轻量优化：截断旧消息中的大 tool call 参数。

典型场景：

- `write_file` 带了很长文件内容。
- `edit_file` 带了很长 patch。

`SummarizationMiddleware` 会在旧消息中对这些 tool call args 截断，而最近消息保持完整。

这一步不是生成 summary，也不写 conversation history。它只是减少旧 tool call 参数继续占据 token。

## 14. read_file 的上下文保护

`read_file` 本身也有截断逻辑。它根据 line limit 和 token limit 返回文件内容，避免一次读取把上下文塞爆。

当文件很大时，它会提示使用 offset/limit 分块读取。

这和 tool result 外置不同：

- `read_file` 截断是工具自身输出控制。
- tool result 外置是 middleware 对任意大 ToolMessage 的后处理。

## 15. Skills 和上下文

Skills 不是总是把全部 `SKILL.md` 内容塞进上下文。

`SkillsMiddleware` 更像一个 skill catalog/loader：先把 skill metadata 暴露给模型，模型需要时再加载具体 skill 内容。这样避免所有 skill 全量进入上下文。

这和 memory 不同：

- memory 是 always-loaded。
- skills 是按需使用。

## 16. Subagent 的上下文隔离

`SubAgentMiddleware` 也是上下文管理的一部分。

主 agent 通过 `task` 工具启动 subagent。subagent 有自己的 prompt、tools、middleware、summarization 和上下文窗口。它执行完后，主 agent 通常只收到一个 `ToolMessage` 结果，而不是所有中间消息。

这减少了主 agent 上下文污染：

- 大量探索过程留在 subagent 内部。
- 主上下文只保留总结结果。
- 主 agent token 压力降低。

## 17. Async subagent 的上下文保留

异步 subagent 更偏后台任务。相关注释提到，异步任务信息可以 survive context compaction/offloading，并可程序化访问。

这说明 async subagent 状态不完全依赖主对话 messages，而是另有 state/任务管理结构。

## 18. UI 消息裁剪不是模型上下文压缩

Textual UI 有 message store/window pruning，只挂载最近一部分消息，避免 UI DOM 太大。

这只影响界面渲染，不等于模型上下文压缩。

真正影响模型看到什么的是：

- LangGraph state 中的 messages
- `_summarization_event`
- middleware 对 model request 的改写
- tool result / human message eviction

## 19. Token 状态

CLI 定义了 `TokenStateMiddleware`，注册 private state：

```python
_context_tokens
```

这个字段不传给模型，但会 checkpoint。CLI 在每次 LLM response 后把 token usage 写入 state。恢复 thread 时，UI 能立刻显示之前的 token 数。

这属于“运行时观测上下文”，不是模型输入上下文。

## 20. Prompt caching

`create_deep_agent()` 会加入 Anthropic prompt caching middleware。`MemoryMiddleware` 也支持给 memory block 加 cache-control breakpoint。

这不会改变模型看到的内容，但会影响成本和性能：

- 静态 system prompt 可以缓存。
- memory block 边界可以缓存。
- memory 更新后不会把整个前缀缓存全部打散。

## 21. Human-in-the-loop 与上下文

HITL 不是普通上下文来源，但会影响上下文演化。

工具审批时：

1. agent 发起 tool call。
2. `HumanInTheLoopMiddleware` interrupt。
3. UI 展示 approve/reject/edit。
4. 用户 decision 通过 `Command(resume=...)` 回到 LangGraph。
5. 被批准的工具继续执行，结果进入 messages。
6. 被拒绝时，模型会看到拒绝反馈，并继续生成后续行动。

`ask_user` 也是类似机制。它把用户回答包装成 `ToolMessage` 写回上下文。也就是说，用户在人机交互中的回答会成为后续模型上下文的一部分。

## 22. 用户中断与上下文保存

如果用户 Ctrl+C / Esc 中断正在运行的 agent，CLI 会 best-effort 保存已经产生的上下文：

- 已累计的 assistant text
- 已展示但未完成的 tool calls
- 一条系统 HumanMessage：任务被用户中断

这通过 `agent.aupdate_state(config, {"messages": [...]})` 写回 checkpoint。

这样后续 resume 时，模型知道上一轮被取消了，而不是静默丢失中间状态。

## 23. Context 恢复流程

恢复 thread 时，CLI 大致流程是：

1. 确定 thread id。
2. 用 `agent.aget_state({"configurable": {"thread_id": thread_id}})` 读取 state。
3. 如果远程 server 刚重启导致 state 为空，则直接读 SQLite checkpointer 的 channel values。
4. 取出 messages。
5. 将 serialized dict 转回 LangChain messages。
6. 转成 UI 的 lightweight `MessageData`。
7. 只挂载可见窗口。
8. 从 `_context_tokens` 恢复 token 显示。

注意，恢复 UI 历史和恢复模型上下文不是一回事：

- UI 恢复是为了显示。
- 模型上下文恢复依赖 LangGraph checkpoint state。

## 24. Backend 路由与上下文存储

CLI 本地模式下使用 `CompositeBackend`：

```text
default -> LocalShellBackend / FilesystemBackend
/large_tool_results/ -> temp FilesystemBackend
/conversation_history/ -> temp FilesystemBackend
```

所以默认本地 CLI 中，large tool results 和 conversation history 会被路由到临时目录，避免污染用户工作目录。

在部署或自定义 backend 场景下，`CompositeBackend` 可以把 memory、conversation history、artifacts 等路由到不同持久化后端。

## 25. 一次模型调用前的上下文合成

从概念上，一次 model call 前会经历类似流程：

1. LangGraph 从 checkpoint 取出 thread state。
2. `MemoryMiddleware` 确保 `memory_contents` 已加载。
3. `LocalContextMiddleware` 确保 `local_context` 已加载或需要刷新。
4. `FilesystemMiddleware` 可能处理过大的 human message。
5. `SummarizationMiddleware` 根据 `_summarization_event` 重建 effective messages。
6. `SummarizationMiddleware` 可能截断旧 tool call args。
7. `SummarizationMiddleware` 可能触发自动 summary。
8. `AskUserMiddleware` / `SummarizationToolMiddleware` / local context / memory 等把自己的 system prompt 片段追加进去。
9. model 看到最终 system prompt + effective messages + tools。

middleware 顺序很重要。`create_deep_agent()` 中 memory 靠后，HumanInTheLoop 最后；CLI 自己的 middleware 又插在 core middleware 之前或中间。

## 26. 容易误解的点

### AGENTS.md 不只是路径

它的内容会进入 system prompt。

### conversation_history 不等于 checkpoint

Checkpoint 是 LangGraph runtime state，包括 messages、private state 等。

`conversation_history` 是 backend 文件路径，用来保存被外置/摘要的原文。

### offload 不一定删除 checkpoint 里的旧消息

核心机制是 `_summarization_event` 改变模型看到的 effective messages。原始 messages 可能仍在 checkpoint 中。

### UI 裁剪不等于上下文裁剪

UI 只显示最近消息，不代表模型只看到最近消息。

### Memory 不一定当前 thread 内热更新

如果 `memory_contents` 已经在 state 里，middleware 不会再次读磁盘。

### Local context 是动态快照，不是长期记忆

它可以刷新，但不应该用来保存用户偏好。用户偏好应进入 AGENTS.md/memory。

## 27. 可以改进或需要注意的地方

### Memory 热更新语义

当前 memory 加载后存在 state。若 agent 在当前 thread 中修改 `AGENTS.md`，是否应立即刷新 `memory_contents` 是一个设计问题。

可选方案：

- 修改 memory 文件后清空 `memory_contents`
- 给 `MemoryMiddleware` 加 mtime/hash 检查
- 对 memory edit tool 做特殊 hook

### conversation_history 持久化策略

本地 CLI 把 `/conversation_history/` 路由到临时目录。这适合不污染项目，但如果用户期望跨进程、跨重启找回完整 offloaded history，需要确认对应 backend 是否持久。

Checkpoint 能恢复 summary state，但 summary message 中引用的 file path 如果指向临时目录，长期可用性要看 backend 生命周期。

### Summary 质量和可追溯性

压缩后模型主要依赖 summary。如果 summary 丢细节，模型需要主动读取 `file_path` 找回原文。可以考虑在 summary prompt 中更明确要求保留：

- 用户明确偏好
- 未完成任务
- 文件路径和关键决策
- 错误和失败尝试

### Local context 刷新时机

当前首次运行和 summarization 后刷新。若工作区发生剧烈变化但未触发 summarization，local context 可能过时。可以考虑在关键文件操作后、git 分支变化后、或每 N turn 刷新。

### Tool result 外置的可发现性

外置结果通过 preview + path 暴露。模型是否会主动读取完整结果取决于 prompt 和任务压力。可以增强提示，让模型在信息不足时优先 `read_file` 外置结果。

## 28. 总结

这个项目的上下文管理是分层的：

- **Memory**：长期规则，来自 AGENTS.md，进入 system prompt。
- **Local context**：当前环境快照，进入 system prompt。
- **Messages**：对话历史，存在 checkpoint。
- **Summarization event**：控制模型实际看到哪些历史。
- **Conversation history files**：保存被外置/摘要的原文。
- **Large tool result files**：保存过大的工具输出。
- **Subagents**：通过上下文隔离减少主上下文污染。
- **Token state**：为 UI 和 offload 决策提供运行时观测。

最核心的一句话是：

> DeepAgents 不是简单地把所有东西塞进 prompt，而是用 middleware 在 model call 前动态合成上下文，并用 checkpoint、summary event 和 backend 文件把“模型当前需要看到的内容”与“系统仍然保存的完整历史”分离开。
