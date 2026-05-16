# DeepAgents Middleware 调研报告索引

本文档目录用于系统学习 DeepAgents middleware 代码逻辑。建议先读本索引，再按主题阅读各专题报告。

## 总体入口

核心入口是 `deepagents/libs/deepagents/deepagents/graph.py` 中的 `create_deep_agent()`。它把 SDK 默认 middleware、用户传入 middleware、profile 额外 middleware、memory/HITL 等能力合并为最终 agent runtime。

主 agent 默认栈的关键顺序：

1. `TodoListMiddleware`
2. 可选 `SkillsMiddleware`
3. `FilesystemMiddleware`
4. 可选 `SubAgentMiddleware`
5. `SummarizationMiddleware`
6. `PatchToolCallsMiddleware`
7. 可选 `AsyncSubAgentMiddleware`
8. 用户传入 `middleware`
9. profile `extra_middleware`
10. 可选 `_ToolExclusionMiddleware`
11. `AnthropicPromptCachingMiddleware`
12. 可选 `MemoryMiddleware`
13. 可选 `HumanInTheLoopMiddleware`

这个顺序值得特别关注：工具注入、system prompt 改写、消息历史压缩、tool 过滤、prompt cache、memory 注入之间有依赖关系。

## 专题报告

- [FilesystemMiddleware](./filesystem-middleware.md)：文件工具、backend 抽象、execute、权限、offload。
- [MemoryMiddleware](./memory-middleware.md)：AGENTS.md/memory sources、system prompt 注入、cache-control。
- [SkillsMiddleware](./skills-middleware.md)：skills catalog、progressive disclosure、source precedence。
- [SubAgentMiddleware / AsyncSubAgentMiddleware](./subagent-middleware.md)：同步/异步 subagent、默认 general-purpose subagent、Agent Protocol 任务。
- [SummarizationMiddleware / SummarizationToolMiddleware](./summarization-middleware.md)：自动压缩、手动 compact、history offload、tool args 截断。
- [Core Utility Middleware](./core-utility-middleware.md)：tool call 修补、tool exclusion、permissions re-export、middleware utils、profile 过滤机制。
- [CLI / REPL / Deploy Middleware](./cli-repl-deploy-middleware.md)：CLI 侧模型切换、ask_user、本地上下文、shell allow-list、REPL、sandbox sync。

## 推荐学习顺序

1. 先读 `graph.py:create_deep_agent()`，建立 middleware 栈的全局图。
2. 读 `middleware/__init__.py`，区分公开 SDK API 和内部 middleware。
3. 读 `FilesystemMiddleware`，因为 backend 和工具体系会被 skills、memory、subagent、summarization 复用。
4. 读 `SkillsMiddleware` 与 `MemoryMiddleware`，理解 system prompt 动态拼装。
5. 读 `SubAgentMiddleware`，理解主 agent 如何把复杂任务外包出去。
6. 读 `SummarizationMiddleware`，理解长上下文如何被压缩和持久化。
7. 最后读 CLI/REPL/Deploy 层，理解产品入口如何在 SDK 默认栈外继续扩展。

## 学习时要抓住的问题

- 这个 middleware 提供的是 tool、system prompt 片段、state schema，还是 model-call wrapper？
- 它在 `create_deep_agent()` 中的位置为什么在那里？
- 它依赖 backend、runtime、state、store、checkpointer 中的哪一个？
- 它对主 agent 和 subagent 的行为是否一致？
- 它是在模型调用前改写 request，还是在 tool 执行前后改写 state/messages？
- 它的失败模式是什么：跳过、报错、fallback，还是继续但记录 warning？
