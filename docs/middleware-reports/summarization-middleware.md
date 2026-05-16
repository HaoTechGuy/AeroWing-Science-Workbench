# SummarizationMiddleware / SummarizationToolMiddleware 调研报告

## 1. 结论速览

DeepAgents 的总结压缩逻辑集中在 `deepagents/libs/deepagents/deepagents/middleware/summarization.py`。这里有两层：

- `SummarizationMiddleware`：公开别名，实际实现类是 `_DeepAgentsSummarizationMiddleware`。它在每次 model call 前检查上下文，必要时自动把旧消息 offload 到 backend，再用 summary 替代模型可见的旧上下文。
- `SummarizationToolMiddleware`：注册 `compact_conversation` 工具。它不会自动压缩，只在模型或人工流程批准 tool call 后执行手动 compact，并复用 `SummarizationMiddleware` 的 cutoff、partition、summary、offload 逻辑。

核心状态不是直接删除 checkpoint 里的 `messages`，而是写入 private state `_summarization_event`。之后每次模型调用都会把 raw state messages 重建成：

```text
effective_messages = [summary_message] + messages[cutoff_index:]
```

因此原始消息仍可能留在 state/checkpoint 里，但模型实际看到的是压缩后的视图。这个设计让自动总结、compact tool、CLI `/offload`/`/compact` 共用同一套状态语义。

## 2. 重要源码路径

- `deepagents/libs/deepagents/deepagents/middleware/summarization.py`
  - `SummarizationEvent`
  - `SummarizationState`
  - `TruncateArgsSettings`
  - `_DeepAgentsSummarizationMiddleware`
  - `SummarizationMiddleware`
  - `create_summarization_middleware`
  - `create_summarization_tool_middleware`
  - `SummarizationToolMiddleware`
- `deepagents/libs/deepagents/deepagents/graph.py`
  - `create_deep_agent()` 默认把 `create_summarization_middleware(model, backend)` 加入主 agent 和 subagent middleware stack。
- `deepagents/libs/cli/deepagents_cli/agent.py`
  - `create_cli_agent()` 创建 `CompositeBackend`，把 `/conversation_history/` 路由到临时 backend，并追加 `create_summarization_tool_middleware(model, composite_backend)`。
  - `_add_interrupt_on()` 将 `compact_conversation` 加入 HITL approval map。
- `deepagents/libs/cli/deepagents_cli/app.py`
  - 命令 `/offload` 和 `/compact` 都进入 `_handle_offload()`。
- `deepagents/libs/cli/deepagents_cli/offload.py`
  - `perform_offload()` 是 CLI 主动 offload 的业务逻辑。
  - `offload_messages_to_backend()` 写 `/conversation_history/{thread_id}.md`。
- `docs/context-management-analysis.md`
  - 可作为上下文管理总览，但本报告以源码为准。

## 3. 入口类与 state schema

`summarization.py` 定义的 state schema 是 `SummarizationState`。它继承 `AgentState`，增加一个私有字段：

```python
_summarization_event: Annotated[NotRequired[SummarizationEvent | None], PrivateStateAttr]
```

`SummarizationEvent` 有三个字段：

- `cutoff_index`：压缩发生时，raw state messages 中的绝对截断位置。
- `summary_message`：一个 `HumanMessage`，内容是摘要，并带有 `additional_kwargs={"lc_source": "summarization"}`。
- `file_path`：完整旧消息 offload 后的 backend 路径，通常是 `/conversation_history/{thread_id}.md`；如果写 backend 失败则为 `None`。

`_DeepAgentsSummarizationMiddleware.state_schema = SummarizationState`，`SummarizationToolMiddleware.state_schema = SummarizationState`。两者共享同一个 `_summarization_event`，所以自动压缩和手动 compact 可以连续发生，并由 `_compute_state_cutoff()` 把 effective list 里的 cutoff 转回 raw state 里的绝对 cutoff。

## 4. 自动总结与手动 compact tool 的关系

自动总结由 `SummarizationMiddleware.wrap_model_call()` / `awrap_model_call()` 实现。它每次模型调用前执行：

1. 根据已有 `_summarization_event` 计算 effective messages。
2. 对旧 `write_file` / `edit_file` tool call args 做轻量截断。
3. 统计 tokens / messages。
4. 如果达到 trigger，执行总结；否则先正常调用模型。
5. 如果正常调用模型抛出 `ContextOverflowError`，立即走总结路径再重试。
6. 通过 `ExtendedModelResponse(command=Command(update={"_summarization_event": new_event}))` 更新 state。

手动 compact tool 由 `SummarizationToolMiddleware` 提供。它的构造函数接收一个 `_DeepAgentsSummarizationMiddleware` 实例，并在 `self.tools` 中放入 `_create_compact_tool()` 创建的 `compact_conversation`。这个工具：

- 复用自动总结 middleware 的 `_apply_event_to_messages()`、`_determine_cutoff_index()`、`_partition_messages()`、`_create_summary()` / `_acreate_summary()`、`_offload_to_backend()` / `_aoffload_to_backend()`。
- 通过 `_is_eligible_for_compaction()` 加一道门槛，大约在自动 summarization trigger 的 50% 时才允许 compact；不满足时返回 `Nothing to compact yet` 的 `ToolMessage`。
- 成功时由 `_build_compact_result()` 返回 `Command(update={...})`，同时更新 `_summarization_event` 并追加一个工具结果 `ToolMessage`。

`SummarizationToolMiddleware.wrap_model_call()` 只负责把 `SUMMARIZATION_SYSTEM_PROMPT` 追加到 system prompt，提示模型何时可以用 `compact_conversation`；它不主动执行压缩。

## 5. 默认阈值与工厂函数

`compute_summarization_defaults(model)` 根据模型 profile 选择默认策略：

- 如果 `model.profile["max_input_tokens"]` 存在：`trigger=("fraction", 0.85)`，`keep=("fraction", 0.10)`，tool args truncation 也按 85% / 10% 的 fraction 配置。
- 如果没有 profile：`trigger=("tokens", 170000)`，`keep=("messages", 6)`，tool args truncation 默认在 20 条消息后触发并保留最近 20 条。

`create_summarization_middleware(model, backend)` 要求传入已 resolve 的 `BaseChatModel`，使用上述 defaults 创建自动总结 middleware。

`create_summarization_tool_middleware(model, backend)` 可以接收 model string；如果是字符串，先 `resolve_model()`，再调用 `create_summarization_middleware()` 创建内部 summarization engine，最后包装成 `SummarizationToolMiddleware`。注意：这个 factory 只返回 tool middleware，本身不会把内部 `SummarizationMiddleware` 注册为自动 middleware；但 `create_deep_agent()` 默认已经注册自动 summarization，所以 CLI 追加这个 tool middleware 后，两层会通过 `_summarization_event` 协作。

## 6. 典型自动调用链

一次典型自动总结调用链如下：

```text
model call
  -> SummarizationMiddleware.wrap_model_call / awrap_model_call
  -> _get_effective_messages
  -> _apply_event_to_messages
  -> _truncate_args
  -> token_counter + _should_summarize
  -> _determine_cutoff_index
  -> _partition_messages
  -> _offload_to_backend / _aoffload_to_backend
  -> _create_summary / _acreate_summary
  -> _build_new_messages_with_path
  -> handler(request.override(messages=[summary] + preserved_messages))
  -> ExtendedModelResponse(Command(update={"_summarization_event": new_event}))
```

关键细节：

1. `wrap_model_call()` 先从 raw request messages 生成 effective messages。如果没有旧事件，effective 就是原始 messages；如果有旧事件，effective 是 summary 加 cutoff 之后的新消息。
2. `_truncate_args()` 在真正总结前尝试压缩旧 tool call 参数。这一步只改当前 request 中传给模型的 message copy，不写 backend，也不更新 state。
3. token 统计会把 `request.system_message` 计入 counted messages；如果 token counter 不支持 `tools=` 参数，则 fallback 到不带 tools 的调用。
4. 未达到 trigger 时，middleware 会直接调用 `handler(request.override(messages=truncated_messages))`。
5. 如果 provider 抛出 `ContextOverflowError`，代码不向上抛，而是继续执行总结路径。
6. 达到 trigger 后，`_determine_cutoff_index()` 决定保留窗口，`_partition_messages()` 分成 `messages_to_summarize` 和 `preserved_messages`。
7. sync 路径先 offload 后 summary；async 路径用 `asyncio.gather()` 并行执行 `_aoffload_to_backend()` 和 `_acreate_summary()`。
8. 最终 model call 使用 `[summary_message] + preserved_messages`，并通过 `ExtendedModelResponse` 将新 `_summarization_event` 写回 state。

## 7. `_summarization_event` 的语义

`_summarization_event` 是整个机制的核心，而不是附属元数据。

`_apply_event_to_messages(messages, event)` 的规则：

- `event is None`：返回 `list(messages)`。
- event 缺 key 或类型异常：记录 warning，返回原始 messages。
- `cutoff_index > len(messages)`：记录 warning，只返回 `[summary_message]`。
- 正常情况：返回 `[summary_message] + messages[cutoff_index:]`。

这意味着压缩后模型看到的历史由事件决定，不由 `messages` 数组是否真的被删除决定。后续再次压缩时，新的 cutoff 是 effective list 的位置，需要 `_compute_state_cutoff(event, effective_cutoff)` 映射回 raw state：

```text
无旧 event: state_cutoff = effective_cutoff
有旧 event: state_cutoff = prior_cutoff + effective_cutoff - 1
```

减 1 是因为 effective list 的 index 0 是 summary message，它不对应 raw state 中的一条真实消息。

## 8. conversation_history backend

自动总结和 compact tool 都通过 `_offload_to_backend()` / `_aoffload_to_backend()` 写入 history 文件。默认路径来自：

```text
{artifacts_root}/conversation_history/{thread_id}.md
```

如果 backend 是 `CompositeBackend`，`artifacts_root` 会影响前缀；否则默认根路径是 `/conversation_history`。`thread_id` 优先来自 LangGraph config 的 `configurable.thread_id`，拿不到时生成 `session_{uuid}`。

写入格式是追加 markdown section：

```markdown
## Summarized at 2026-...

...get_buffer_string(filtered_messages)...
```

写入前会调用 `_filter_summary_messages()`，过滤掉 `lc_source="summarization"` 的旧 summary message，避免链式 summarization 时把“摘要的摘要”重复写进 history。读取旧内容时用 `download_files()` / `adownload_files()`，因为普通 `read()` 可能返回带行号、适合 LLM 消费但不适合原样编辑的内容。已有文件用 `edit` / `aedit` 追加；没有旧内容则 `write` / `awrite`。

offload 失败不是致命错误。自动 middleware 会记录 warning，并继续生成 summary，只是 `file_path=None`，summary message 不再包含可回读的完整历史路径。

CLI 的 local mode 会额外创建一个 `FilesystemBackend(root_dir=tempfile.mkdtemp(prefix="deepagents_conversation_history_"), virtual_mode=True)`，并通过 `CompositeBackend(routes={"/conversation_history/": conversation_history_backend})` 把 conversation history 放到临时目录，避免污染工作区。sandbox mode 则不额外路由，直接使用 sandbox backend。

## 9. tool args truncation

`TruncateArgsSettings` 是完整 summarization 前的轻量优化。它有四类配置：

- `trigger`：何时触发，可为 messages / tokens / fraction；`None` 表示禁用。
- `keep`：最近多少消息或 token 不动。
- `max_length`：单个字符串参数超过多少字符才截断，默认 2000。
- `truncation_text`：截断后追加的后缀，默认 `...(argument truncated)`。

执行路径是 `_truncate_args()`：

1. 统计 `system_message + messages` 的 tokens。
2. `_should_truncate_args()` 判断是否达到截断阈值。
3. `_determine_truncate_cutoff_index()` 找到“旧消息”和“最近保留窗口”的边界。
4. 只处理 cutoff 之前的 `AIMessage.tool_calls`。
5. 目前只对 tool name 为 `write_file` 或 `edit_file` 的调用截断 args。
6. `_truncate_tool_call()` 对超过 `max_length` 的字符串参数保留前 20 个字符，再加 truncation suffix。

这一步不产生 summary，不写 `/conversation_history`，不更新 `_summarization_event`。它只是降低旧 tool call 参数继续占用上下文的成本。

## 10. ContextOverflow fallback

`wrap_model_call()` 和 `awrap_model_call()` 都有相同策略：

- 如果 `_should_summarize()` 为 false，先用当前 effective/truncated messages 正常调用模型。
- 如果该调用抛出 `ContextOverflowError`，代码进入 summarization path。
- 如果 cutoff 无法产生可压缩分区，才退回到直接调用模型。

这解决了 token counter 低估、provider 实际上下文策略更严格、工具 schema 或 system prompt 额外开销导致的 over-budget 问题。它把“阈值触发”之外的 provider 拒绝也纳入压缩重试路径。

## 11. CLI 如何接入 compact_conversation

CLI 的 agent 创建路径在 `deepagents_cli/agent.py`：

1. `create_cli_agent()` 先构造 backend。local mode 下，`/large_tool_results/` 和 `/conversation_history/` 都会路由到临时 `FilesystemBackend`；sandbox mode 下不加特殊 route。
2. 然后导入 `create_summarization_tool_middleware`。
3. 执行 `agent_middleware.append(create_summarization_tool_middleware(model, composite_backend))`。
4. 最后调用 `create_deep_agent(..., middleware=agent_middleware, backend=composite_backend, ...)`。

同时，`_add_interrupt_on()` 在 `REQUIRE_COMPACT_TOOL_APPROVAL=True` 时把 `compact_conversation` 加入 interrupt map。也就是说，当模型决定调用 `compact_conversation` 时，CLI 可以像处理 `execute`、`write_file`、`edit_file` 等工具一样走人工 approve/reject 流程。

需要区分两种“手动”：

- `compact_conversation` tool：模型发起普通 tool call，`SummarizationToolMiddleware` 执行。它有 50% trigger 的 eligibility gate，成功后返回 `Command(update={"_summarization_event": ...})`。
- CLI `/offload` 或 `/compact` 命令：用户在 CLI 输入命令，`app.py` 直接进入 `_handle_offload()`，不会等待模型选择 tool。

## 12. CLI `/offload` / `/compact` 调用链

`app.py` 中命令分发把 `/offload` 和 `/compact` 都交给 `_handle_offload()`。

典型链路：

```text
用户输入 /offload 或 /compact
  -> App._handle_offload
  -> _get_thread_state_values(thread_id)
  -> perform_offload(...)
  -> normalize serialized message dicts if needed
  -> create_model(...)
  -> compute_summarization_defaults(model)
  -> SummarizationMiddleware(model, backend, keep=defaults["keep"])
  -> _apply_event_to_messages(messages, prior_event)
  -> _determine_cutoff_index
  -> _partition_messages
  -> _acreate_summary
  -> offload_messages_to_backend
  -> _build_new_messages_with_path
  -> _compute_state_cutoff
  -> OffloadResult(new_event=...)
  -> agent.aupdate_state({"_summarization_event": result.new_event})
  -> persist context token count
```

`perform_offload()` 与自动 middleware 的一个差异是：它先生成 summary，再写 backend。源码注释说明这样做是为了 LLM summarization 失败时不产生 backend side effect。自动 middleware 的 sync 路径则先 offload 再 summary；async 路径二者并行。

`offload_messages_to_backend()` 的写入 section 标题是 `## Offloaded at ...`，路径固定为 `/conversation_history/{thread_id}.md`。它同样复用 middleware 的 `_filter_summary_messages()` 避免重复保存 summary message。若 backend 写失败，`perform_offload()` 仍会返回 `OffloadResult`，但 `offload_warning` 非空，`file_path=None`。

## 13. 与 `docs/context-management-analysis.md` 的对照

对照文档中的总体描述与源码一致：自动 summarization、`compact_conversation`、CLI `/offload`/`/compact` 都最终围绕 `_summarization_event` 工作。需要以源码补充的细节有：

- `create_summarization_tool_middleware()` 只注册 tool middleware；自动 summarization 是 `create_deep_agent()` 默认注册的另一层 middleware。
- `compact_conversation` tool 有基于 reported token usage 的 50% trigger eligibility gate。
- CLI local mode 中 `/conversation_history/` 被 route 到临时 `FilesystemBackend`。
- 自动 async summarization 中 offload 与 summary 是并发的；CLI 主动 offload 中 summary 先于 backend 写入。
- tool args truncation 只处理旧 `AIMessage.tool_calls` 中 `write_file` 和 `edit_file` 的字符串参数。

## 14. 建议读源码顺序

1. 先读 `summarization.py` 顶部的数据结构：`SummarizationEvent`、`TruncateArgsSettings`、`SummarizationState`、`compute_summarization_defaults()`。
2. 再读 `_DeepAgentsSummarizationMiddleware.__init__()`，理解它如何包装 LangChain 的 `LCSummarizationMiddleware`，以及 DeepAgents 额外加入 backend 和 args truncation。
3. 读 `_apply_event_to_messages()` 和 `_compute_state_cutoff()`。这是理解“state 不删消息，但模型视图被压缩”的关键。
4. 读 `_truncate_args()`、`_offload_to_backend()`、`_build_new_messages_with_path()`，掌握压缩前优化、history 持久化和 summary message 格式。
5. 读 `wrap_model_call()` / `awrap_model_call()`，串起自动总结的完整执行链。
6. 读 `create_summarization_middleware()` 和 `create_summarization_tool_middleware()`，确认默认注册方式和 tool middleware 的组合关系。
7. 读 `SummarizationToolMiddleware._create_compact_tool()`、`_is_eligible_for_compaction()`、`_run_compact()` / `_arun_compact()`、`wrap_model_call()`，理解 compact tool 如何作为普通 tool call 接入。
8. 转到 `graph.py`，看 `create_deep_agent()` 何处默认注册自动 summarization。
9. 转到 CLI：先读 `agent.py` 的 `create_cli_agent()` 和 `_add_interrupt_on()`，再读 `app.py` 的 `_handle_offload()`，最后读 `offload.py` 的 `perform_offload()`。

## 15. 关键问题清单

- `_summarization_event.cutoff_index` 是 effective messages 的 index，还是 raw state messages 的 index？为什么二次压缩要 `prior_cutoff + effective_cutoff - 1`？
- summary message 为什么是 `HumanMessage`，并通过 `additional_kwargs["lc_source"]` 标记？
- 自动 summarization 为什么不直接修改 `state["messages"]`？
- backend 写失败时，为什么仍然继续 summary？这对可恢复性有什么影响？
- CLI `/offload` 为什么先 summary 再 offload，而自动 middleware 的 sync 路径先 offload 再 summary？
- `compact_conversation` tool 为什么要用 reported token usage 做 50% trigger gate？如果 provider 不返回 usage，会发生什么？
- `tool args truncation` 为什么只截断 `write_file` 和 `edit_file`，而不是所有 tool calls？
- local CLI 把 `/conversation_history/` 放进临时 backend，对跨进程 resume 或用户事后查找历史有什么影响？
- `ContextOverflowError` fallback 能覆盖哪些 token counter 误差场景？哪些场景仍可能失败？
- `create_summarization_tool_middleware()` 内部创建的 summarization engine 与 `create_deep_agent()` 默认注册的自动 summarization middleware 是否是同一个实例？它们如何通过 `_summarization_event` 协作？

