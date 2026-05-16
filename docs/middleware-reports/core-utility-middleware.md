# Core Utility Middleware 调研报告

本文聚焦 DeepAgents 中偏“基础设施”的 middleware 与 profile 过滤机制：`PatchToolCallsMiddleware`、`_ToolExclusionMiddleware`、`permissions.py` 的兼容导出、`append_to_system_message()` 工具函数，以及 `HarnessProfile.excluded_tools` / `excluded_middleware` / `extra_middleware` 如何影响最终 middleware stack。

## 关键源码路径

- `deepagents/libs/deepagents/deepagents/graph.py`
  - `create_deep_agent()`
  - `_REQUIRED_MIDDLEWARE`
  - `_REQUIRED_MIDDLEWARE_CLASSES`
  - `_REQUIRED_MIDDLEWARE_NAMES`
- `deepagents/libs/deepagents/deepagents/middleware/patch_tool_calls.py`
  - `PatchToolCallsMiddleware`
- `deepagents/libs/deepagents/deepagents/middleware/_tool_exclusion.py`
  - `_ToolExclusionMiddleware`
  - `_tool_name()`
- `deepagents/libs/deepagents/deepagents/middleware/permissions.py`
  - `FilesystemPermission` re-export
- `deepagents/libs/deepagents/deepagents/middleware/_utils.py`
  - `append_to_system_message()`
- `deepagents/libs/deepagents/deepagents/_excluded_middleware.py`
  - `_validate_excluded_middleware_config()`
  - `_apply_excluded_middleware()`
  - `_verify_excluded_middleware_coverage()`
  - `_raise_on_name_collisions()`
- `deepagents/libs/deepagents/deepagents/profiles/harness/harness_profiles.py`
  - `HarnessProfile`
  - `HarnessProfileConfig`
  - `HarnessProfile.materialize_extra_middleware()`
  - `_merge_profiles()`
  - `_validate_config_middleware_string()`
  - `_serialize_runtime_excluded_middleware_entry()`

## 组件职责

### PatchToolCallsMiddleware

`PatchToolCallsMiddleware` 位于 `middleware/patch_tool_calls.py`，继承 `langchain.agents.middleware.AgentMiddleware`，实现 `before_agent()`。

它解决的是“消息历史中存在悬空 tool call”的问题：如果某条 `AIMessage` 发起了 tool call，但历史里没有对应 `ToolMessage` 回答该 `tool_call_id`，下一轮 agent 运行可能因为 tool call / tool result 配对不完整而出错。该 middleware 会：

1. 读取 `state["messages"]`。
2. 收集所有已有 `ToolMessage.tool_call_id`，得到 `answered_ids`。
3. 扫描所有 `AIMessage.tool_calls`，找出没有被回答的 tool call。
4. 在原消息后插入合成的 `ToolMessage`，内容说明该工具调用已被取消。
5. 返回 `{"messages": Overwrite(patched_messages)}`，用 LangGraph 的 `Overwrite` 替换消息历史。

这不是一个给模型调用的业务工具，而是 agent 运行前的状态修复器。它需要在模型/agent 下一步调度前直接改写消息历史，所以放在 middleware 层非常自然。

在 `graph.py:create_deep_agent()` 中，它出现在多个 DeepAgents 自己组装的栈里：

- 声明式 subagent 栈：`TodoListMiddleware`、`FilesystemMiddleware`、summarization、`PatchToolCallsMiddleware`
- 默认 general-purpose subagent 栈：同样包含 `PatchToolCallsMiddleware`
- 主 agent 栈：summarization 之后、可选 `AsyncSubAgentMiddleware` 之前

这个位置说明它属于“历史一致性保护层”：在 summarization 可能改写/压缩历史之后，继续保证 tool call 配对完整。

### _ToolExclusionMiddleware

`_ToolExclusionMiddleware` 位于 `middleware/_tool_exclusion.py`，是内部 middleware。它的目标不是删除某个 middleware，而是在每次模型调用前过滤 request 上的工具列表。

核心逻辑：

- `_tool_name(tool)` 支持两种工具形态：
  - `BaseTool` 实例：读 `tool.name`
  - dict 工具：读 `tool["name"]`
- `wrap_model_call()` / `awrap_model_call()` 在请求进入模型前执行：
  - 如果 `self._excluded` 非空，构造 `filtered = [t for t in request.tools if _tool_name(t) not in self._excluded]`
  - 通过 `request.override(tools=filtered)` 得到新的 model request
  - 再调用下游 handler

它被放在 profile `extra_middleware` 之后、prompt caching / memory / HITL 之前。注释也明确说：tool exclusion 要在所有“会注入工具”的 middleware 之后运行，这样既能过滤用户传入的工具，也能过滤 DeepAgents middleware 注入的工具，例如 filesystem、subagent、skills 等相关工具。

这和 `excluded_middleware` 的语义不同：

- `excluded_tools`：保留 middleware，但让模型看不到指定工具。
- `excluded_middleware`：从最终 middleware stack 中移除整个 middleware。

例如想隐藏 `execute`，应该使用 `excluded_tools={"execute"}`。如果试图移除 `FilesystemMiddleware`，不仅会删除 `execute`，还会破坏文件工具和权限执行路径，因此会被脚手架保护逻辑拒绝。

### permissions.py re-export

`middleware/permissions.py` 只有一个职责：

```python
from deepagents.middleware.filesystem import FilesystemPermission

__all__ = ["FilesystemPermission"]
```

这是向后兼容导出层。当前 `FilesystemPermission` 的真实定义在 `middleware/filesystem.py`，同时 `deepagents/__init__.py` 和 `middleware/__init__.py` 也从 filesystem 模块导出它。保留 `middleware/permissions.py` 可以让旧代码继续从 `deepagents.middleware.permissions import FilesystemPermission` 导入，而不需要迁移所有调用方。

从职责上看，permissions 本身不是 middleware；权限真正执行在 `FilesystemMiddleware` 内部。这个文件只是兼容 API 面的轻量 shim。

### append_to_system_message()

`append_to_system_message()` 位于 `middleware/_utils.py`，是多个 middleware 共享的 system prompt 拼接工具。它接收一个可选 `SystemMessage` 和一段文本，返回新的 `SystemMessage`。

关键行为：

- 如果已有 `system_message`，先复制它的 `content_blocks`，避免原地修改。
- 如果原内容非空，在追加文本前加两个换行。
- 追加一个 `{"type": "text", "text": text}` content block。
- 如果没有原 system message，则创建只包含该文本块的新 `SystemMessage`。

使用方包括：

- `FilesystemMiddleware`：追加文件系统相关工具说明。
- `MemoryMiddleware`：把 memory 内容注入 system message。
- `SkillsMiddleware`：追加 skills catalog / skill 使用说明。
- `SummarizationMiddleware`：追加 summarization 相关系统指令。
- `SubAgentMiddleware` / `AsyncSubAgentMiddleware`：追加 subagent system prompt。

这个 helper 的价值在于统一保留 structured content blocks。尤其当上游 system message 里已有 cache-control 等结构化 block 时，middleware 只追加新的 text block，而不是把内容粗暴拼成普通字符串。

## Profile 如何影响最终 middleware stack

DeepAgents 的入口是 `graph.py:create_deep_agent()`。函数会先解析模型并得到 `_profile = _harness_profile_for_model(model, _model_spec)`，再根据 profile 组装主 agent、默认 general-purpose subagent，以及声明式 subagent 的 middleware stack。

### excluded_tools：最后阶段过滤工具可见性

`HarnessProfile.excluded_tools` 是一个工具名集合。它不会影响 middleware 是否存在，而是触发 `_ToolExclusionMiddleware` 被追加到 stack：

```python
if _profile.excluded_tools:
    deepagent_middleware.append(_ToolExclusionMiddleware(excluded=_profile.excluded_tools))
```

同样逻辑也出现在默认 general-purpose subagent 和声明式 subagent 的栈里。

调用链可以概括为：

1. profile 通过 `excluded_tools` 声明要隐藏的工具名。
2. `create_deep_agent()` 先组装基础 middleware、用户 middleware、profile `extra_middleware`。
3. 如果 `excluded_tools` 非空，追加 `_ToolExclusionMiddleware`。
4. 模型调用时 `_ToolExclusionMiddleware.wrap_model_call()` 过滤 `request.tools`。

注意：工具描述覆盖 `tool_description_overrides` 会先通过 `_apply_tool_description_overrides()` 应用；工具排除则留给 `_ToolExclusionMiddleware`，因为只有在 middleware 注入工具之后，最终工具全集才完整。

### excluded_middleware：装配后裁剪 middleware 栈

`HarnessProfile.excluded_middleware` 可以包含两类条目：

- middleware 类对象：精确匹配 `type(mw)`，不是 `isinstance()`。
- 字符串：精确匹配 `mw.name`。

过滤逻辑在 `_excluded_middleware.py`：

1. `_validate_excluded_middleware_config()`：先拒绝删除必需脚手架。
2. `_apply_excluded_middleware()`：遍历已组装 stack，删除匹配条目，并记录哪些 class/name 命中过。
3. `_raise_on_name_collisions()`：如果一个字符串名在同一 stack 中匹配多个不同类，报错，要求改用 class-form 排除。
4. `_verify_excluded_middleware_coverage()`：所有相关 stack 过滤完成后，检查每个 exclusion 至少在某处命中过；否则认为是 typo 或过期 profile，抛 `ValueError`。

`graph.py` 定义了不可移除的脚手架：

```python
_REQUIRED_MIDDLEWARE = (
    (FilesystemMiddleware, ()),
    (SubAgentMiddleware, ()),
)
```

原因是：

- `FilesystemMiddleware` 支撑内置文件工具，并执行 `permissions` 规则。
- `SubAgentMiddleware` 支撑 `task` 工具处理。

所以如果目标只是移除 `task` 工具，不应该排除 `SubAgentMiddleware`，而应通过 `general_purpose_subagent.enabled=False` 且不传同步 subagents，让 `SubAgentMiddleware` 根本不被加入主栈。

另一个细节是 alias。`_DeepAgentsSummarizationMiddleware` 是私有实现类，但它设置了：

- `serialized_name = "SummarizationMiddleware"`
- `name` property 返回 `"SummarizationMiddleware"`

因此配置文件里可以用 `excluded_middleware: ["SummarizationMiddleware"]` 排除它，而不暴露私有类名。

### extra_middleware：profile 追加运行时 middleware

`HarnessProfile.extra_middleware` 是运行时能力，只存在于 `HarnessProfile`，不属于 `HarnessProfileConfig`。它可以是：

- middleware 实例序列；
- 零参数 factory，返回 middleware 序列。

`HarnessProfile.materialize_extra_middleware()` 每次返回一个新 list；如果是 factory，会在每次 materialize 时调用，适合避免多个 stack 共享同一个有状态 middleware 实例。

`create_deep_agent()` 会把 profile `extra_middleware` 追加到它自己组装的 stack：

- 主 agent stack
- 默认 general-purpose subagent stack
- 声明式 `SubAgent` 转换出的 subagent stack

但不会应用到：

- `CompiledSubAgent`：它已经是预编译 runnable，有自己的 middleware 链。
- `AsyncSubAgent`：它运行在远端 graph，本地无法也不应该注入 middleware。

顺序上，profile `extra_middleware` 在用户 `middleware` 之后，在 `_ToolExclusionMiddleware` 之前。因此 profile 额外 middleware 如果注入了工具，也会被 `excluded_tools` 的最终过滤看到。

### profile 合并语义

`harness_profiles.py:_merge_profiles()` 描述了 provider-level profile 和 model-level profile 的合并方式：

- `base_system_prompt`、`system_prompt_suffix` 等单值字段：override 有值则覆盖 base。
- `tool_description_overrides`：dict 合并，override 同 key 胜出。
- `excluded_tools`：集合并集。
- `excluded_middleware`：集合并集。
- `extra_middleware`：按 middleware 类型合并；同类 override 替换 base 原位置，新类型追加。
- `general_purpose_subagent`：字段级合并，显式值优先。

这意味着“排除”是累加策略：provider profile 排除了 `execute`，model profile 又排除了 `grep`，最终两者都会被隐藏。

## 最终 stack 装配顺序

以主 agent 为例，`create_deep_agent()` 的关键顺序是：

1. `TodoListMiddleware`
2. 可选 `SkillsMiddleware`
3. `FilesystemMiddleware`
4. 可选 `SubAgentMiddleware`
5. summarization middleware
6. `PatchToolCallsMiddleware`
7. 可选 `AsyncSubAgentMiddleware`
8. 用户传入 `middleware`
9. profile `extra_middleware`
10. 可选 `_ToolExclusionMiddleware`
11. `AnthropicPromptCachingMiddleware`
12. 可选 `MemoryMiddleware`
13. 可选 `HumanInTheLoopMiddleware`
14. `_apply_excluded_middleware()` 裁剪 stack
15. `_verify_excluded_middleware_coverage()` 校验所有排除项都命中过

默认 general-purpose subagent 和声明式 subagent 也有类似结构，只是没有主 agent 的 async subagent / memory / HITL 部分，且声明式 subagent 会根据自己的 model 查自己的 harness profile。

## 为什么这些基础组件放在 middleware 层，而不是普通 tool

普通 tool 只有在模型选择调用它时才运行，而这些组件需要在模型调用之前或 agent 调度之前生效：

- `PatchToolCallsMiddleware` 需要在 agent 下一步执行前修复 `state["messages"]`，属于状态一致性维护。
- `_ToolExclusionMiddleware` 需要拦截每一次 `ModelRequest`，动态改变模型能看到的工具集合。
- `append_to_system_message()` 服务的 middleware 都需要在模型调用前改写 system message，而不是等模型主动调用工具。
- `FilesystemPermission` 的实际执行依附 `FilesystemMiddleware` 的工具实现；权限是工具执行路径上的策略，不是模型可选调用的业务功能。
- `excluded_middleware` / `extra_middleware` 面向的是 runtime stack 的装配与裁剪，本质上是 agent graph 组装策略，不是单个工具行为。

`middleware/__init__.py` 的概述也给出同样边界：middleware 可以过滤工具、注入 system prompt、转换消息、维护跨轮 state；普通 tool 只能被 LLM 调用，不能在 LLM 调用前统一拦截 request。

## 学习建议

推荐阅读顺序：

1. `graph.py:create_deep_agent()`：先建立主 agent、GP subagent、声明式 subagent 三类 stack 的装配图。
2. `profiles/harness/harness_profiles.py:HarnessProfile`：理解 `excluded_tools`、`excluded_middleware`、`extra_middleware` 字段语义。
3. `profiles/harness/harness_profiles.py:HarnessProfileConfig`：理解哪些配置可序列化，为什么 `extra_middleware` 是 runtime-only。
4. `middleware/_tool_exclusion.py:_ToolExclusionMiddleware`：看 `excluded_tools` 如何真正作用于 `request.tools`。
5. `_excluded_middleware.py`：按 validate、apply、verify 三步读，重点看错误保护逻辑。
6. `middleware/patch_tool_calls.py:PatchToolCallsMiddleware`：理解 dangling tool call 的修补方式。
7. `middleware/_utils.py:append_to_system_message()`：再反查 filesystem、memory、skills、subagents、summarization 对它的调用。
8. `tests/unit_tests/test_harness_profiles.py`：看 config round-trip、grammar validation、runtime-only rejection、extra middleware materialize 的测试。

关键问题清单：

- 某个需求是“隐藏工具”还是“移除整个 middleware”？
- 被排除的是用户工具、middleware 注入工具，还是 middleware 本身？
- 当前 middleware 是否属于 `_REQUIRED_MIDDLEWARE`，移除会不会破坏脚手架能力？
- 字符串形式的 `excluded_middleware` 匹配的是类名还是 `AgentMiddleware.name`？
- private middleware 是否提供了 `serialized_name` 和 public `.name` alias？
- `extra_middleware` 是静态实例还是 factory？多个 stack 是否会共享实例状态？
- profile 是 provider-level、model-level，还是用户注册覆盖？合并后 exclusion 是否被并集累加？
- 声明式 subagent 是否使用了自己的 model profile，而不是主 agent profile？
- `CompiledSubAgent` / `AsyncSubAgent` 为什么不会接收本地 `extra_middleware`？
- 如果一个 `excluded_middleware` 条目没有命中，应该是 typo、过期 profile，还是 stack 本来就不包含该 middleware？

