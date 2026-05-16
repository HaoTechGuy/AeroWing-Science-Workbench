# MemoryMiddleware 调研报告

## 1. 结论速览

`MemoryMiddleware` 的职责很窄：在 agent 每次运行前，从配置好的 `AGENTS.md` / memory 文件列表读取内容，写入私有 state；在模型调用前，把这些内容格式化为 `<agent_memory>` 区块并追加到 system prompt。它不负责发现文件、不负责写入记忆，也不解析 Markdown 结构。

有两条主要接入路径：

- SDK 路径：调用 `create_deep_agent(memory=[...])`，由 `deepagents.graph.create_deep_agent` 自动追加 `MemoryMiddleware(add_cache_control=True)`。
- CLI 路径：`deepagents_cli.agent.create_cli_agent` 根据 `assistant_id` 和当前项目自动构造 memory sources，并把 `MemoryMiddleware` 放入传给 `create_deep_agent(middleware=...)` 的用户 middleware 列表。

一个重要差异是：SDK 的 `memory=` 接入会打开 MemoryMiddleware 自己的 Anthropic cache-control 标记；CLI 手动接入目前没有传 `add_cache_control=True`。

## 2. 重要源码路径

- `deepagents/libs/deepagents/deepagents/middleware/memory.py`
  - `MemoryState`
  - `MemoryStateUpdate`
  - `MEMORY_SYSTEM_PROMPT`
  - `MemoryMiddleware`
  - `MemoryMiddleware.before_agent`
  - `MemoryMiddleware.abefore_agent`
  - `MemoryMiddleware.modify_request`
  - `MemoryMiddleware.wrap_model_call`
  - `MemoryMiddleware.awrap_model_call`
- `deepagents/libs/deepagents/deepagents/middleware/_utils.py`
  - `append_to_system_message`
- `deepagents/libs/deepagents/deepagents/graph.py`
  - `create_deep_agent`
  - `AnthropicPromptCachingMiddleware` 与 `MemoryMiddleware` 的尾部 middleware 排序
- `deepagents/libs/cli/deepagents_cli/agent.py`
  - `create_cli_agent`
- `deepagents/libs/cli/deepagents_cli/config.py`
  - `Settings.get_user_agent_md_path`
  - `Settings.get_project_agent_md_path`
- `deepagents/libs/cli/deepagents_cli/project_utils.py`
  - `find_project_agent_md`
- `deepagents/libs/cli/deepagents_cli/_server_config.py`
  - `ServerConfig.enable_memory`
  - `ServerConfig.to_env`
  - `ServerConfig.from_env`
- `deepagents/libs/cli/deepagents_cli/server_graph.py`
  - `make_graph`
- 相关测试：
  - `deepagents/libs/deepagents/tests/unit_tests/middleware/test_memory_middleware.py`
  - `deepagents/libs/deepagents/tests/unit_tests/middleware/test_memory_middleware_async.py`

## 3. 入口类与 state schema

入口类是 `MemoryMiddleware`，继承自 `AgentMiddleware[MemoryState, ContextT, ResponseT]`，并设置：

```python
state_schema = MemoryState
```

`MemoryState` 继承 `AgentState`，只新增一个字段：

```python
memory_contents: NotRequired[Annotated[dict[str, str], PrivateStateAttr]]
```

含义：

- key 是 source 路径字符串。
- value 是该 source 文件的 UTF-8 文本内容。
- `PrivateStateAttr` 表示该字段是 middleware 私有状态，不进入最终 agent 输出。
- `NotRequired` 表示初始 state 可以没有这个字段。

`MemoryStateUpdate` 则是 `before_agent` / `abefore_agent` 返回的更新结构：

```python
memory_contents: dict[str, str]
```

这个设计把“文件已加载”的状态本身也作为缓存标记：只要 state 中已经存在 `memory_contents`，后续 `before_agent` 会短路，不再重新读文件。

## 4. sources 加载流程

`MemoryMiddleware.__init__` 接收三个关键参数：

- `backend`：文件后端实例或后端 factory。
- `sources`：`list[str]`，通常是若干 `AGENTS.md` 路径。
- `add_cache_control`：是否在 Anthropic 请求中给 memory block 加 cache-control。

加载发生在 `before_agent` / `abefore_agent`：

1. 检查 `if "memory_contents" in state`。
2. 如果存在，直接返回 `None`，表示本轮不更新 state。
3. 通过 `_get_backend` 得到后端：
   - 如果 `backend` 是 callable，会临时构造一个 `ToolRuntime` 调用 factory。
   - 否则直接使用传入的 backend 实例。
4. 调用 `backend.download_files(list(self.sources))` 或 `backend.adownload_files(...)`。
5. 按 `zip(self.sources, results, strict=True)` 把响应写回对应路径。
6. 如果错误是 `file_not_found`，静默跳过。
7. 如果是其他错误，抛 `ValueError("Failed to download ...")`。
8. 如果 `response.content` 存在，用 UTF-8 decode 后写入 `contents[path]`。
9. 返回 `MemoryStateUpdate(memory_contents=contents)`。

注意：`MemoryMiddleware` 不会自己创建文件。CLI 会在启用 memory 或 skills 时创建用户级空文件；SDK 路径则由调用方或 backend 提供文件。

## 5. AGENTS.md / memory 文件的读取、合并与短路

### 读取

读取是批量的，完全依赖 backend 的 `download_files` / `adownload_files`。在默认 CLI 本地路径中，使用的是 `FilesystemBackend()`；在 SDK `create_deep_agent(memory=...)` 中，使用调用者传入的 `backend`，如果未传，最终会走 graph 内部默认 backend 逻辑。

### 合并

合并发生在 `_format_agent_memory(contents)`，不是读取阶段。

合并规则：

- 按 `self.sources` 的顺序输出，而不是按 dict 插入顺序。
- 每个有内容的 source 形成一个 section：

```text
{path}
{contents[path]}
```

- 多个 section 之间用两个换行连接。
- 没有任何内容时，输出 `(No memory loaded)`。
- 缺失文件不会出现在 prompt 中。

最终内容被塞进 `MEMORY_SYSTEM_PROMPT`：

```text
<agent_memory>
...
</agent_memory>

<memory_guidelines>
...
</memory_guidelines>
```

`memory_guidelines` 是固定指导语，告诉模型何时更新 memory、何时不要更新、不要保存密钥等。

### 短路与缓存

短路逻辑很简单但很关键：

```python
if "memory_contents" in state:
    return None
```

含义：

- 同一个 graph state / thread 中，只要 `memory_contents` 已存在，就不会重新读文件。
- 即使文件系统中的 `AGENTS.md` 后续被外部修改，当前 state 也不会自动刷新。
- 如果某个 source 第一次不存在，返回的 `memory_contents` 仍会写入 state，之后也会因为字段存在而短路。
- 这种缓存是 state 级别的，不是文件 mtime 或内容 hash 级别的。

这也解释了为什么模型被要求通过 `edit_file` 更新 memory：写文件本身不会让当前已加载的 `memory_contents` 自动变新，通常要到新的 state / 会话加载路径中才会体现。

## 6. CLI 如何配置 memory sources

CLI 的核心入口是 `create_cli_agent`。

当 `enable_memory=True` 时，它构造：

```python
memory_sources = [str(settings.get_user_agent_md_path(assistant_id))]
project_agent_md_paths = (
    project_context.project_agent_md_paths()
    if project_context is not None
    else settings.get_project_agent_md_path()
)
memory_sources.extend(str(p) for p in project_agent_md_paths)
```

也就是说 CLI sources 顺序是：

1. 用户级 agent memory：`~/.deepagents/{assistant_id}/AGENTS.md`
2. 项目级 `.deepagents/AGENTS.md`，如果存在
3. 项目根目录 `AGENTS.md`，如果存在

项目级发现逻辑在 `find_project_agent_md(project_root)`：

- 只检查两个候选：
  - `{project_root}/.deepagents/AGENTS.md`
  - `{project_root}/AGENTS.md`
- 两者都存在时都加载，`.deepagents/AGENTS.md` 在前。
- 对 symlink 做安全检查：解析后的目标必须仍在 project root 内，否则跳过并 warning。
- 缺失、broken symlink 等按不存在处理。

用户级 `AGENTS.md` 的路径由 `Settings.get_user_agent_md_path(agent_name)` 固定生成。`create_cli_agent` 在启用 memory 或 skills 时，会确保 `~/.deepagents/{assistant_id}/AGENTS.md` 存在；如果不存在则 `touch()` 一个空文件。

CLI 运行在 LangGraph server 子进程时，`enable_memory` 通过 `ServerConfig` 传递：

- CLI 侧：`ServerConfig.to_env()` 写入 `DEEPAGENTS_CLI_SERVER_ENABLE_MEMORY`。
- server 侧：`ServerConfig.from_env()` 读取，默认是 `True`。
- `server_graph.make_graph()` 把 `config.enable_memory` 传给 `create_cli_agent`。

在当前源码里，没有看到面向普通 CLI 参数的任意 memory source 配置；sources 是由 `assistant_id`、当前项目上下文和 `enable_memory` 开关推导出来的。

## 7. 典型调用链追踪

### CLI 路径

1. 用户启动 CLI，选择或默认使用某个 `assistant_id`。
2. CLI server 配置经 `ServerConfig` 进入 `server_graph.make_graph()`。
3. `make_graph()` 调用 `create_cli_agent(..., enable_memory=config.enable_memory, project_context=...)`。
4. `create_cli_agent` 如果启用 memory：
   - 确保 `~/.deepagents/{assistant_id}/AGENTS.md` 存在。
   - 发现项目级 `AGENTS.md`。
   - 构造 `MemoryMiddleware(backend=FilesystemBackend(), sources=memory_sources)`。
   - 把它 append 到 `agent_middleware`。
5. `create_cli_agent` 调用 `create_deep_agent(..., middleware=agent_middleware, ...)`。
6. `create_deep_agent` 组装默认 deep agent prompt，并把 CLI 的 MemoryMiddleware 作为“用户 middleware”插入基础栈和尾部栈之间。
7. agent 执行时：
   - `MemoryMiddleware.before_agent` 从 sources 读取文件，写入 `state["memory_contents"]`。
   - 模型调用前，`MemoryMiddleware.wrap_model_call` 调用 `modify_request`。
   - `modify_request` 把 `<agent_memory>` 和 `<memory_guidelines>` 追加到 system prompt。
8. 模型收到的 system prompt 大致是：
   - CLI / SDK 传入的 `system_prompt`，如果有
   - SDK 默认 deep agent prompt
   - MemoryMiddleware 追加的 memory 区块

### SDK 路径

1. 调用：

```python
create_deep_agent(
    model=...,
    backend=...,
    memory=["/path/to/AGENTS.md"],
)
```

2. `create_deep_agent` 在尾部 middleware 中无条件加入 `AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")`。
3. 如果 `memory is not None`，继续 append：

```python
MemoryMiddleware(
    backend=backend,
    sources=memory,
    add_cache_control=True,
)
```

4. prompt 组装先处理 `system_prompt` 与 `BASE_AGENT_PROMPT`：
   - `system_prompt=None`：只使用 base prompt。
   - `system_prompt` 是字符串：`system_prompt + "\n\n" + base_prompt`。
   - `system_prompt` 是 `SystemMessage`：保留原有 `content_blocks`，再追加 base prompt block。
5. 模型调用前，memory middleware 再把 memory block 追加到这个 system prompt 后面。

## 8. 与 system prompt 的关系

`MemoryMiddleware` 不替换 system prompt，只追加内容。追加工具函数是 `append_to_system_message(system_message, text)`：

- 如果原本有 system message，先保留原 content blocks。
- 如果已有内容，给追加文本前面加两个换行。
- 新增一个 text content block。

因此 memory 总是作为后置系统上下文出现。它不是用户消息，也不是 tool message。

`MEMORY_SYSTEM_PROMPT` 里包含两层内容：

- `<agent_memory>`：实际读取到的 source 路径和内容。
- `<memory_guidelines>`：固定规则，指导模型如何学习、何时写入、何时不要写入。

这种设计让模型既看到“已有长期记忆”，又看到“如何维护长期记忆”的策略。

## 9. Anthropic cache-control 逻辑

相关代码分两层。

第一层在 `create_deep_agent`：

- 尾部 middleware 总是 append `AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")`。
- 这个 middleware 对非 Anthropic 模型 no-op。
- 注释说明：profile middleware 放在 user middleware 和 memory 之间，是为了 memory 更新不会破坏 Anthropic prompt cache prefix。

第二层在 `MemoryMiddleware.modify_request`：

```python
if self._add_cache_control and isinstance(request.model, ChatAnthropic) and new_system_message.content_blocks:
    blocks = list(new_system_message.content_blocks)
    last = blocks[-1]
    base = last if isinstance(last, dict) else {}
    blocks[-1] = {**base, "cache_control": {"type": "ephemeral"}}
    new_system_message = SystemMessage(content_blocks=blocks)
```

关键点：

- 只在 `add_cache_control=True` 时启用。
- 只认 `langchain_anthropic.ChatAnthropic` 实例。
- 非 Anthropic 模型静默跳过，避免把 Anthropic-only 参数传给其他 provider。
- 只标记最后一个 content block，也就是 MemoryMiddleware 刚追加的 memory block。
- 通过 `{**base, ...}` 合并，保留 block 原有的 `type` / `text` 字段。
- SDK `create_deep_agent(memory=...)` 会传 `add_cache_control=True`。
- CLI 手动创建 `MemoryMiddleware` 时没有传这个参数，所以默认是 `False`。

设计意图可以理解为两个 cache breakpoint：

1. `AnthropicPromptCachingMiddleware` 负责静态 system prompt 前缀。
2. `MemoryMiddleware(add_cache_control=True)` 负责 memory block 边界。

这样当 memory 文件变化导致后置 memory 内容变化时，前面的稳定 prompt 前缀仍更容易命中 Anthropic prompt cache。

还有一个 CLI 相关保护点在 `deepagents_cli.configurable_model`：运行时如果从 Anthropic 切换到非 Anthropic 模型，会剥离 `cache_control` 这类 Anthropic-only settings，避免 provider 参数不兼容。

## 10. 边界行为与注意事项

- `memory=[]` 与 `memory is not None` 不同：SDK 中只要传了空列表，也会安装 `MemoryMiddleware`，最后 prompt 中会出现 `(No memory loaded)` 和固定 memory guidelines。
- 缺失文件不是错误；其他 backend 错误会抛 `ValueError`。
- 文件内容默认按 UTF-8 decode；非 UTF-8 内容会在 decode 时失败。
- `_format_agent_memory` 会跳过空字符串内容，因为判断是 `if contents.get(path)`。
- CLI 项目级 `AGENTS.md` 会被注入 system prompt，因此 symlink 安全检查很重要。
- `memory_contents` 是私有 state，但仍参与 state 短路；调试时要注意它不一定出现在最终输出里。
- MemoryMiddleware 只加载主 agent 的 memory。subagent 是否有自己的 memory 取决于它是否另行配置 middleware / graph。

## 11. 建议读源码顺序

1. 先读 `memory.py` 的 `MemoryState`、`MemoryMiddleware.__init__`、`before_agent`、`modify_request`，建立最小模型。
2. 再读 `_utils.append_to_system_message`，确认 system prompt 是追加 block，不是字符串拼接替换。
3. 读 `graph.py:create_deep_agent` 的参数说明和尾部 middleware 组装，重点看 `AnthropicPromptCachingMiddleware` 与 `MemoryMiddleware(add_cache_control=True)` 的位置。
4. 读 `agent.py:create_cli_agent`，看 CLI 如何构造 `memory_sources`。
5. 读 `config.py:get_user_agent_md_path` 与 `project_utils.py:find_project_agent_md`，理解用户级和项目级 `AGENTS.md` 的来源及 symlink 安全策略。
6. 最后读 `test_memory_middleware.py` / async 测试，验证缺失文件、顺序、短路、cache-control 的边界行为。

## 12. 关键问题清单

- 当前调用路径是 SDK `memory=`，还是 CLI 手动 middleware？
- `sources` 的顺序是否符合期望？后置内容会更靠近模型最终 system prompt 末尾。
- 是否需要在当前会话内重新加载 memory？如果需要，仅修改文件不够，必须考虑 `memory_contents` state 短路。
- 是否会加载项目级 `AGENTS.md`？当前 project root 是哪里？
- 项目级 `AGENTS.md` 是否可能通过 symlink 指向项目外？`find_project_agent_md` 会跳过这种情况。
- 模型是否真的是 `ChatAnthropic`？如果是 Bedrock / Vertex Anthropic 包装，`isinstance(request.model, ChatAnthropic)` 不成立。
- 是否需要 Anthropic cache-control？SDK `memory=` 会打开；CLI 默认手动 middleware 不打开。
- 传入 `system_prompt` 是字符串还是 `SystemMessage`？后者可以保留调用方已有的 `cache_control` content blocks。
- 缺失 memory 文件是预期还是配置错误？代码会静默跳过 `file_not_found`。
- 空 memory 文件是否应该显示？当前空内容会被当作无内容，最终显示 `(No memory loaded)`。
