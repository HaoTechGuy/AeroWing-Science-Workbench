# FilesystemMiddleware 调研报告

## 1. 结论速览

`FilesystemMiddleware` 是 DeepAgents 的文件系统与执行能力入口。它负责三件事：

1. 给 agent 注入内置工具：`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`execute`。
2. 在模型调用前补充文件系统/执行工具的 system prompt，并根据 backend 能力动态隐藏 `execute`。
3. 在上下文过大时做 offload：大工具结果写入 `/large_tool_results/`，超大用户消息写入 `/conversation_history/`。

核心源码：

- `deepagents/libs/deepagents/deepagents/middleware/filesystem.py`
- `deepagents/libs/deepagents/deepagents/backends/protocol.py`
- `deepagents/libs/deepagents/deepagents/backends/state.py`
- `deepagents/libs/deepagents/deepagents/backends/filesystem.py`
- `deepagents/libs/deepagents/deepagents/backends/composite.py`
- `deepagents/libs/deepagents/deepagents/backends/local_shell.py`
- `deepagents/libs/deepagents/deepagents/graph.py`

## 2. 入口类与 state schema

入口类是 `FilesystemMiddleware`，定义在 `middleware/filesystem.py:642`，继承：

```python
AgentMiddleware[FilesystemState, ContextT, ResponseT]
```

它声明：

```python
state_schema = FilesystemState
```

`FilesystemState` 定义在 `middleware/filesystem.py:234`，只扩展一个 state 字段：

```python
files: Annotated[NotRequired[dict[str, FileData]], _file_data_reducer]
```

`files` 是虚拟文件系统状态通道。默认 `StateBackend` 会通过 LangGraph config 内部的 `CONFIG_KEY_READ` / `CONFIG_KEY_SEND` 读写这个字段，而不是让工具手动返回 `files_update`。`_file_data_reducer()` 支持 dict merge，也支持用 `None` 标记删除旧文件。

`FileData` 来自 `backends/protocol.py:157`，当前 v2 格式大致是：

```python
{
  "content": str,
  "encoding": "utf-8" | "base64",
  "created_at": str,
  "modified_at": str,
}
```

## 3. 提供的 tools

`FilesystemMiddleware.__init__()` 会把下列工具放进 `self.tools`：

- `ls`：列目录，入口 `_create_ls_tool()`，源码 `filesystem.py:794`。
- `read_file`：读文件，入口 `_create_read_file_tool()`，源码 `filesystem.py:885`。
- `write_file`：写新文件，入口 `_create_write_file_tool()`，源码 `filesystem.py:1040`。
- `edit_file`：精确字符串替换，入口 `_create_edit_file_tool()`，源码 `filesystem.py:1131`。
- `glob`：按 glob 找文件，入口 `_create_glob_tool()`，源码 `filesystem.py:1228`。
- `grep`：按字面量搜索文件内容，入口 `_create_grep_tool()`，源码 `filesystem.py:1343`。
- `execute`：执行 shell 命令，入口 `_create_execute_tool()`，源码 `filesystem.py:1450`。

工具参数 schema 也都在同一个文件中：

- `LsSchema`
- `ReadFileSchema`
- `WriteFileSchema`
- `EditFileSchema`
- `GlobSchema`
- `GrepSchema`
- `ExecuteSchema`

每个工具都有 sync/async 两套 wrapper，并最终用 `StructuredTool.from_function(...)` 暴露给 LangChain agent。

重要细节：

- 所有文件路径先走 `validate_path()`，要求以 `/` 开头，拒绝不合法路径。
- `ls`、`glob`、`grep` 的结果会再按 `FilesystemPermission` 过滤。
- `read_file` 对文本文件做行号格式化；对图片、音频、视频、PDF 等会返回 multimodal content block。
- `read_file` 默认分页：`offset=0`、`limit=100`。
- `glob` 有独立超时：`GLOB_TIMEOUT = 20.0` 秒。
- `execute` 工具即使被注册，也会在模型请求阶段根据 backend 能力动态过滤。

## 4. 关键 hook

`FilesystemMiddleware` 主要实现两个 hook，各自有 sync/async 版本：

### 4.1 `wrap_model_call()` / `awrap_model_call()`

源码位置：

- `wrap_model_call()`：`filesystem.py:1640`
- `awrap_model_call()`：`filesystem.py:1712`

职责：

1. 检查 request tools 中是否有 `execute`。
2. 解析 backend，并调用 `supports_execution()` 判断 backend 是否支持命令执行。
3. 如果 backend 不支持执行，从 `request.tools` 里移除 `execute`。
4. 追加 filesystem system prompt；如果 `execute` 可用，再追加 execution system prompt。
5. 调用 `_evict_and_truncate_messages()` 处理超大 `HumanMessage`。
6. 如果新 offload 了 human message，返回 `ExtendedModelResponse`，里面携带 `Command(update={"messages": [tagged]})` 写回 state。

这里更像 LangChain middleware 里的“modify request + wrap model call”合体逻辑：项目没有单独命名 `modify_request()`，而是在 `wrap_model_call()` 内完成 request 改写后再调用 handler。

### 4.2 `wrap_tool_call()` / `awrap_tool_call()`

源码位置：

- `wrap_tool_call()`：`filesystem.py:2117`
- `awrap_tool_call()`：`filesystem.py:2138`

职责：

1. 先执行原始 tool handler。
2. 如果工具在 `TOOLS_EXCLUDED_FROM_EVICTION` 中，直接返回。
3. 否则检查 `ToolMessage` 或 `Command(update={"messages": [...]})` 里的工具结果是否过大。
4. 过大时把完整文本写入 backend 的 `/large_tool_results/<tool_call_id>`。
5. 返回一个替换后的 `ToolMessage`：内容是说明、文件路径、head/tail preview，保留原消息的 id、name、artifact、status、metadata。

被排除的大结果 offload 工具有：

```python
("ls", "glob", "grep", "read_file", "edit_file", "write_file")
```

所以典型会被 offload 的是 `execute` 或用户自定义工具的大输出。

## 5. create_deep_agent 中如何装配

装配入口是 `deepagents/libs/deepagents/deepagents/graph.py:create_deep_agent()`。

默认 backend：

```python
backend = backend if backend is not None else StateBackend()
```

位置：`graph.py:476`。

主 agent middleware stack 中，顺序大致是：

1. `TodoListMiddleware()`
2. `SkillsMiddleware(...)`，如果启用 skills
3. `FilesystemMiddleware(...)`
4. `SubAgentMiddleware(...)`，如果有同步 subagent
5. `SummarizationMiddleware`
6. `PatchToolCallsMiddleware`
7. `AsyncSubAgentMiddleware`，如果有 async subagent
8. 用户传入 middleware
9. profile extra middleware / tool exclusion
10. `AnthropicPromptCachingMiddleware`
11. `MemoryMiddleware`，如果启用 memory
12. `HumanInTheLoopMiddleware`，如果传了 `interrupt_on`

主 agent 注入 `FilesystemMiddleware` 的位置在 `graph.py:633`。

同步 subagent 也会获得自己的 `FilesystemMiddleware`：

- 用户显式 subagent：`graph.py:506`
- 自动 general-purpose subagent：`graph.py:578`

权限规则会传入 `_permissions`：

```python
FilesystemMiddleware(
    backend=backend,
    custom_tool_descriptions=_profile.tool_description_overrides,
    _permissions=permissions,
)
```

subagent 的权限逻辑是：如果 subagent spec 自己提供 `permissions`，则覆盖父级；否则继承顶层 `permissions`。

## 6. 典型调用链追踪

### 6.1 从 create_deep_agent 到工具注入

1. 用户调用 `create_deep_agent(model=..., backend=...)`。
2. 如果未传 backend，默认创建 `StateBackend()`。
3. `create_deep_agent()` 构造 `deepagent_middleware`。
4. `FilesystemMiddleware.__init__()` 保存 backend、阈值、权限规则，并创建 7 个工具。
5. `create_agent(..., tools=_tools, middleware=deepagent_middleware)` 由 LangChain 把 middleware tools 合并进 agent 可用工具集。

### 6.2 模型请求前

1. 运行到模型调用前，`FilesystemMiddleware.wrap_model_call()` 收到 `ModelRequest`。
2. 它检查 `request.tools` 是否包含 `execute`。
3. 如果当前 backend 不是 `SandboxBackendProtocol`，或 `CompositeBackend.default` 不是 sandbox，则把 `execute` 从 request tools 过滤掉。
4. 追加 filesystem prompt；如果执行可用，追加 execute prompt。
5. 检查消息列表中是否有已 tagged 的 human message，或最后一条 human message 是否超过阈值。

### 6.3 tool 执行

以 `read_file("/foo.txt", offset=0, limit=100)` 为例：

1. LangChain ToolNode 调用 `read_file` 的 wrapper。
2. wrapper 用 `_get_backend(runtime)` 解析 backend；如果 backend 是旧式 callable factory，会在这里调用 factory。
3. 路径走 `validate_path()`。
4. 权限走 `_check_fs_permission(..., "read", path)`。
5. 调用 backend 的 `read(path, offset, limit)` 或 `aread(...)`。
6. `StateBackend` 从 state 的 `files` 通道读；`FilesystemBackend` 从真实磁盘读；`CompositeBackend` 按 path prefix 路由到子 backend。
7. middleware 把 `ReadResult.file_data` 格式化成 tool message。

### 6.4 大工具结果 offload

1. tool handler 返回 `ToolMessage`。
2. `wrap_tool_call()` 检查工具名是否允许 eviction。
3. `_process_large_message()` 用 `content_blocks` 提取文本内容。
4. 如果文本长度超过 `NUM_CHARS_PER_TOKEN * tool_token_limit_before_evict`，默认约 `4 * 20000` 字符，则写入：

```text
/large_tool_results/<sanitized_tool_call_id>
```

如果 backend 是 `CompositeBackend` 且设置了 `artifacts_root`，路径会变成：

```text
<artifacts_root>/large_tool_results/<sanitized_tool_call_id>
```

5. 原 tool result 被替换成路径说明和 head/tail preview。

### 6.5 超大 HumanMessage offload

1. `wrap_model_call()` 调用 `_evict_and_truncate_messages()`。
2. `_check_eviction_needed()` 只检查“最后一条 message 是否是未 offload 的 `HumanMessage` 且超过阈值”。
3. 默认阈值是 `human_message_token_limit_before_evict = 50000`，即约 `4 * 50000` 字符。
4. 满足条件时写入：

```text
/conversation_history/<uuid>.md
```

5. 原 `HumanMessage` 不直接丢弃，而是在 state 中打上：

```python
additional_kwargs["lc_evicted_to"] = file_path
```

6. 给模型的 request messages 中，这条 human message 会替换成“已保存到某路径 + preview”的轻量版本；state 里通过 `ExtendedModelResponse` 更新 tagged message。
7. 之后每次模型调用，只要看到 `lc_evicted_to`，都会重新构建轻量 preview，避免完整长文本再次进入模型上下文。

注意：这里的 `/conversation_history/<uuid>.md` 是单条超大用户消息的 offload；它和 SummarizationMiddleware 的 thread 级 `/conversation_history/<thread_id>.md` 不是同一个粒度。

## 7. backend 抽象

### 7.1 `BackendProtocol`

定义在 `backends/protocol.py:318`，统一文件操作接口：

- `ls` / `als`
- `read` / `aread`
- `write` / `awrite`
- `edit` / `aedit`
- `grep` / `agrep`
- `glob` / `aglob`
- `upload_files` / `aupload_files`
- `download_files` / `adownload_files`

返回值统一为 dataclass，例如：

- `ReadResult`
- `WriteResult`
- `EditResult`
- `LsResult`
- `GrepResult`
- `GlobResult`

这个 protocol 仍保留旧 API 兼容层，比如 `ls_info`、`glob_info`、`grep_raw`，但会发 deprecation warning。

### 7.2 `SandboxBackendProtocol`

定义在 `backends/protocol.py:769`，继承 `BackendProtocol`，额外要求：

- `id` property
- `execute(command, *, timeout=None)`
- `aexecute(command, *, timeout=None)`

`execute` 返回 `ExecuteResponse`，包含：

- `output`
- `exit_code`
- `truncated`

`execute_accepts_timeout()` 在 `protocol.py:828`，通过 inspect 判断某个 backend 类的 `execute` 是否显式支持 `timeout` 参数，用于兼容旧 sandbox backend。

### 7.3 主要 backend

`StateBackend`：`backends/state.py`

- 默认 backend。
- 文件存在 LangGraph state 的 `files` 字段里。
- 适合临时文件、测试、checkpoint 内持久化。
- 不能执行 shell，因此 `execute` 会在模型请求中被过滤掉。

`FilesystemBackend`：`backends/filesystem.py`

- 直接读写真正磁盘。
- `virtual_mode=False` 时绝对路径不受 `root_dir` 限制，安全风险很高。
- `virtual_mode=True` 时把路径解释为 root_dir 下的虚拟绝对路径，阻止 `..`、`~` 和逃逸 root 的路径；但这不是进程隔离。
- 支持文本/二进制读写、ripgrep 优先的 grep、Python fallback、glob、upload/download。

`CompositeBackend`：`backends/composite.py`

- 按 path prefix 路由文件操作。
- 例如 `routes={"/memories/": StoreBackend()}` 时，`/memories/a.md` 会转发给对应 route backend，内部路径变成 `/a.md`。
- 根目录 `ls("/")` 会聚合 default backend 和 route 目录。
- `execute` 不按路径路由，只委托给 `default` backend。
- `artifacts_root` 会影响 large tool result 和 conversation history 的写入前缀。

`LocalShellBackend`：`backends/local_shell.py`

- 继承 `FilesystemBackend` 和 `SandboxBackendProtocol`。
- `execute()` 用 `subprocess.run(..., shell=True)` 在本机执行命令。
- 没有真正 sandbox，风险极高，代码注释明确建议配合 HITL 使用。

## 8. execute 工具启用条件

`execute` 的启用有两层：

1. `FilesystemMiddleware.__init__()` 总是创建 `_create_execute_tool()`。
2. `wrap_model_call()` 在每次模型请求前动态判断是否保留。

判断函数是 `supports_execution()`，位置 `filesystem.py:453`：

- 如果 backend 是 `CompositeBackend`，只看 `backend.default` 是否是 `SandboxBackendProtocol`。
- 否则看 backend 本身是否是 `SandboxBackendProtocol`。

因此：

- `StateBackend()`：不支持执行，`execute` 会从模型 tools 中移除。
- `FilesystemBackend()`：不支持执行。
- `LocalShellBackend()`：支持执行。
- `CompositeBackend(default=LocalShellBackend(), routes=...)`：支持执行。
- `CompositeBackend(default=StateBackend(), routes={"/sandbox/": LocalShellBackend()})`：不支持执行，因为 execute 只走 default。

如果 somehow 运行时仍调用了 `execute`，工具 wrapper 里还有 runtime check，会返回 “backend does not support command execution” 的错误，而不是抛异常。

## 9. 权限与 timeout 逻辑

### 9.1 FilesystemPermission

`FilesystemPermission` 定义在 `filesystem.py:76`：

```python
FilesystemPermission(
    operations=["read" | "write"],
    paths=["/workspace/**"],
    mode="allow" | "deny",
)
```

规则特点：

- 路径必须以 `/` 开头。
- 不允许 `..`。
- 不支持 `~`。
- 匹配使用 `wcmatch.globmatch()`，支持 `**`、brace 等。
- 规则按声明顺序匹配，first match wins。
- 没有匹配时默认 allow。

工具映射：

- read：`ls`、`read_file`、`glob`、`grep`
- write：`write_file`、`edit_file`

权限目前在 middleware tool 层执行，不在 backend 层执行。直接调用 backend 不会自动受 `_permissions` 限制。

一个重要限制：如果 backend 支持 execution，而且权限路径没有全部 scoped 到 `CompositeBackend` routes，`FilesystemMiddleware` 会拒绝初始化并抛 `NotImplementedError`。原因是 shell `execute` 可以绕过文件工具权限，当前还没有 execute 级别的权限模型。

### 9.2 execute timeout

`FilesystemMiddleware.__init__()` 参数：

```python
max_execute_timeout: int = 3600
```

初始化时要求 `max_execute_timeout > 0`。

`execute(command, timeout=None)` 的 wrapper 会检查：

- `timeout < 0`：返回错误。
- `timeout > max_execute_timeout`：返回错误。
- backend 的 `execute` 不支持 timeout 参数但用户传了 timeout：返回错误，提示升级 sandbox backend 或省略 timeout。

如果 timeout 合法，调用 backend：

```python
executable.execute(command, timeout=timeout)
```

或 async：

```python
await executable.aexecute(command, timeout=timeout)
```

`LocalShellBackend` 自己还有默认 timeout，默认 `DEFAULT_EXECUTE_TIMEOUT = 120` 秒，并对输出做 `max_output_bytes` 截断。

## 10. 相关测试与文档证据

建议重点看这些测试：

- `deepagents/libs/deepagents/tests/unit_tests/middleware/test_filesystem_middleware_init.py`
  - 验证 `FilesystemMiddleware` 初始化、tool description override。
- `deepagents/libs/deepagents/tests/unit_tests/test_file_system_tools.py`
  - 端到端验证 `write_file`、`edit_file`、`grep`、state reducer 等。
- `deepagents/libs/deepagents/tests/unit_tests/test_permissions.py`
  - 权限规则校验、first match wins、read/write 区分、sandbox backend 限制。
- `deepagents/libs/deepagents/tests/unit_tests/backends/test_protocol.py`
  - backend protocol 的 NotImplemented 和兼容旧 API 行为。
- `deepagents/libs/deepagents/tests/unit_tests/backends/test_timeout_compat.py`
  - `execute_accepts_timeout()`、legacy backend timeout 兼容。
- `deepagents/libs/deepagents/tests/unit_tests/backends/test_filesystem_backend.py`
  - 真实文件系统 backend 行为。
- `deepagents/libs/deepagents/tests/unit_tests/backends/test_composite_backend.py`
  - route prefix、路径 remap、default backend 逻辑。
- `deepagents/libs/deepagents/tests/unit_tests/backends/test_local_shell_backend.py`
  - 本地 shell 执行、超时、输出截断。
- `deepagents/libs/deepagents/tests/integration_tests/test_filesystem_middleware.py`
  - 与真实模型/agent runtime 集成行为。

已有上下文管理分析可辅助理解 offload：

- `docs/context-management-analysis.md`

## 11. 推荐读源码顺序

1. `graph.py:create_deep_agent()`
   - 先理解 middleware 栈顺序，以及 backend 如何被传给主 agent/subagent。
2. `middleware/filesystem.py:FilesystemMiddleware.__init__()`
   - 看配置项、工具注册、`_large_tool_results_prefix` 和 `_conversation_history_prefix`。
3. `middleware/filesystem.py` 的 7 个 `_create_*_tool()`
   - 逐个看路径校验、权限、backend 调用、ToolMessage 格式。
4. `middleware/filesystem.py:wrap_model_call()`
   - 理解 system prompt、execute 动态过滤、human message offload。
5. `middleware/filesystem.py:wrap_tool_call()`
   - 理解 tool result offload。
6. `backends/protocol.py`
   - 建立 backend contract 的完整地图。
7. `backends/state.py` 与 `backends/composite.py`
   - 理解默认 state 文件系统和 route 机制。
8. `backends/filesystem.py` 与 `backends/local_shell.py`
   - 理解真实磁盘读写与 shell 执行风险。
9. `tests/unit_tests/test_permissions.py` 与 `test_timeout_compat.py`
   - 补齐边界条件和安全约束。

## 12. 关键问题清单

学习或改动这个 middleware 前，建议带着这些问题读代码：

- 当前 backend 是 `StateBackend`、`FilesystemBackend`、`CompositeBackend` 还是 `LocalShellBackend`？
- 这个路径会被 `CompositeBackend` 路由到哪个子 backend？
- 当前 tool 是 read 还是 write 操作？会不会被 `FilesystemPermission` 拦截？
- 权限规则是否和 shell execution 同时启用？如果启用，是否可能被 execute 绕过？
- `execute` 是真的暴露给模型了吗，还是在 `wrap_model_call()` 中被过滤掉了？
- 用户传的 `timeout` 是否超过 `max_execute_timeout`？backend 是否支持 timeout 参数？
- 工具结果是否会被 `TOOLS_EXCLUDED_FROM_EVICTION` 排除？
- 大结果写到了 `/large_tool_results/` 还是带 `artifacts_root` 的路径？
- 超大 human message 是新 offload，还是已经有 `lc_evicted_to` 标记？
- `read_file` 返回的是文本行号内容，还是 multimodal content block？
- 如果使用 `FilesystemBackend(virtual_mode=False)`，是否有读取真实绝对路径或逃逸 `root_dir` 的安全风险？

## 13. 一句话心智模型

`FilesystemMiddleware` 是 DeepAgents 的“文件工具适配层 + backend 路由入口 + 上下文减压阀”：工具调用最终落到 backend；模型看到的工具和提示会按 backend 动态调整；过大的输入/输出会被转存成文件路径，避免直接塞爆上下文。
