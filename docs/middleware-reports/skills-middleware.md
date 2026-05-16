# SkillsMiddleware 调研报告

## 1. 入口类与职责定位

`SkillsMiddleware` 的核心源码在 `deepagents/libs/deepagents/deepagents/middleware/skills.py`。

入口类是：

- `SkillsMiddleware`
- `SkillMetadata`
- `SkillsState`
- `SkillsStateUpdate`

它的职责不是把所有 skill 文件全文塞进 system prompt，而是实现一个 **skills catalog + progressive disclosure** 机制：

1. 启动 agent 前，从配置的 skill sources 扫描目录。
2. 只解析每个 `SKILL.md` 的 YAML frontmatter，得到 name、description、path 等元数据。
3. 在模型调用前，把 skill 列表和读取路径追加到 system prompt。
4. 模型判断某个 skill 适用后，再通过 `read_file(path, limit=1000)` 加载完整 `SKILL.md`。

这让 skills 成为一种“按需展开”的能力库：模型先看到目录和摘要，需要时才读取详细工作流、示例和辅助脚本说明。

## 2. State Schema

`SkillsMiddleware.state_schema = SkillsState`。

`SkillsState` 继承 `AgentState`，包含两个 private state 字段：

- `skills_metadata: list[SkillMetadata]`
- `skills_load_errors: list[str]`

这两个字段都用 `PrivateStateAttr` 标记。含义是：它们属于 middleware 内部状态，不会作为普通 state 传播给 parent agents。它们会被 middleware 用来缓存已发现的 skills，并在后续 model request 中生成 system prompt 片段。

`SkillsStateUpdate` 是 `before_agent()` / `abefore_agent()` 返回的更新结构：

- 必填 `skills_metadata`
- 可选 `skills_load_errors`

关键缓存逻辑：

- `before_agent()` 和 `abefore_agent()` 先检查 `"skills_metadata" in state`。
- 只要 state 中已经存在这个键，即使列表为空，也不会重新扫描 sources。
- 因此 skills 是“每个 session / checkpoint 状态加载一次”的语义。
- 如果需要 CLI 场景下刷新 skills，CLI 层另有 `/reload` 和 `_discover_skills()` 之类的机制；SDK middleware 本身不会每轮自动重扫。

## 3. SkillMetadata 与 frontmatter 解析

每个 skill 目录的约定结构是：

```text
<source>/
  <skill-name>/
    SKILL.md
    helper.py
    references/...
```

`SKILL.md` 必须以 YAML frontmatter 开头，例如：

```markdown
---
name: web-research
description: Structured approach to conducting web research
license: MIT
allowed-tools: read_file grep execute
module: ./index.ts
---
```

解析路径：

- `_list_skills_with_errors(backend, source_path)`
- `_skill_metadata_from_response(response, skill_dir_path, skill_md_path)`
- `_parse_skill_metadata(content, skill_path, directory_name)`
- `_validate_skill_name(name, directory_name)`
- `_validate_metadata(raw, skill_path)`
- `_validate_module_path(raw, skill_path)`

`SkillMetadata` 的主要字段：

- `path`: `SKILL.md` 的 backend path，后续 system prompt 会提示模型读取这个路径。
- `name`: skill 标识。规范上要求小写字母、数字、单 hyphen，且要匹配父目录名。
- `description`: skill 适用场景和能力描述，是模型判断是否使用 skill 的主要依据。
- `license`
- `compatibility`
- `metadata`
- `allowed_tools`
- `module`: 可选 JS/TS 入口，供 QuickJS / REPL 这类消费者使用；`SkillsMiddleware` 只解析和校验，不执行模块。

实现细节：

- `MAX_SKILL_FILE_SIZE = 10MB`，避免超大 `SKILL.md` 造成 DoS。
- `description` 最长 1024 字符，超出会截断。
- `compatibility` 最长 500 字符，超出会截断。
- `allowed-tools` 只接受字符串，并按空白拆分，同时兼容逗号。
- `module` 必须是相对路径，不能是绝对路径，不能逃逸 skill 目录，扩展名限制在 JS/TS 系列。
- `_validate_skill_name()` 不合规范时记录 warning；当前实现出于兼容性不会直接拒绝所有旧格式，但解析失败、无 frontmatter、无 name/description、非 UTF-8 等情况会跳过。

## 4. Sources 到 system prompt 的学习路径

完整路径可以按这条链路理解：

```text
sources
  -> backend.ls(source_path)
  -> 找 source 下的一级目录
  -> backend.download_files([.../SKILL.md])
  -> _parse_skill_metadata()
  -> skills_metadata state
  -> modify_request()
  -> SKILLS_SYSTEM_PROMPT
  -> 模型看到 skill name / description / path
  -> 模型用 read_file(path, limit=1000) 加载完整 SKILL.md
  -> 按 skill 指令读取辅助文件或执行脚本
```

对应关键函数：

- `SkillsMiddleware.before_agent()`
- `SkillsMiddleware.abefore_agent()`
- `_list_skills_with_errors()`
- `_alist_skills_with_errors()`
- `SkillsMiddleware.modify_request()`
- `SkillsMiddleware._format_skills_locations()`
- `SkillsMiddleware._format_skills_list()`
- `append_to_system_message()`

`SKILLS_SYSTEM_PROMPT` 会注入以下几类信息：

- skill source 位置列表。
- source loading warnings。
- available skills 列表。
- 每个 skill 的 description、可选 annotation、allowed tools、读取路径。
- progressive disclosure 指令：匹配任务、读取完整 `SKILL.md`、遵循指令、访问辅助文件。

示例 system prompt 形态可参考 `deepagents/libs/deepagents/tests/unit_tests/smoke_tests/snapshots/system_prompt_with_memory_and_skills.md`。

## 5. Progressive Disclosure 思路

SkillsMiddleware 的关键设计是“元数据常驻，全文按需”：

- 常驻上下文只包含：`name`、`description`、`path`、少量 annotation。
- 大量细节留在 `SKILL.md` 和同目录文件里。
- 模型只有判断相关时才调用 `read_file`。
- prompt 明确要求读取时传 `limit=1000`，因为 `read_file` 默认 100 行通常不够读完整 skill。

这个设计解决两类问题：

- 上下文效率：避免几十个 skill 全文占满模型上下文。
- 可组合性：skill 可以带脚本、配置、参考文档，模型只在需要时打开。

CLI 的 `/skill:<name>` 是另一条加载路径：它不是等待模型自己从 catalog 里选择，而是用户显式点名某个 skill。CLI 会读取完整 `SKILL.md`，包装成一条 human prompt 发送给 agent。

相关源码：

- `deepagents/libs/cli/deepagents_cli/app.py`
  - `_discover_skills()`
  - `_invoke_skill()`
  - `_handle_skill_command()`
- `deepagents/libs/cli/deepagents_cli/skills/load.py`
  - `list_skills()`
  - `load_skill_content()`
- `deepagents/libs/cli/deepagents_cli/skills/invocation.py`
  - `discover_skills_and_roots()`
  - `build_skill_invocation_envelope()`
- `deepagents/libs/cli/deepagents_cli/command_registry.py`
  - `parse_skill_command()`
  - `build_skill_commands()`

因此可以区分两种“学习 skill”的方式：

- 模型自主学习：system prompt 看到 catalog，然后自己 `read_file`。
- 用户强制调用：`/skill:name args`，CLI 直接把完整 `SKILL.md` 作为用户消息的一部分送入 agent。

## 6. Source Precedence

SDK middleware 的通用规则很简单：

- `sources` 按列表顺序加载。
- 同名 skill 用 dict 按 `name` 去重。
- 后加载的 source 覆盖先加载的 source。
- 所以是 **last one wins**。

源码位置：

- `SkillsMiddleware.before_agent()`
- `SkillsMiddleware.abefore_agent()`

代码模式是：

```python
all_skills: dict[str, SkillMetadata] = {}
for source_path in self.sources:
    source_skills, source_error = _list_skills_with_errors(backend, source_path)
    for skill in source_skills:
        all_skills[skill["name"]] = skill
skills = list(all_skills.values())
```

CLI 侧在 `deepagents/libs/cli/deepagents_cli/agent.py` 组装 source，顺序从低优先级到高优先级：

1. built-in: `deepagents_cli/built_in_skills/`
2. user deepagents: `~/.deepagents/<assistant_id>/skills/`
3. user agents alias: `~/.agents/skills/`
4. project deepagents: `<project>/.deepagents/skills/`
5. project agents alias: `<project>/.agents/skills/`
6. user Claude experimental: `~/.claude/skills/`
7. project Claude experimental: `<project>/.claude/skills/`

这意味着同名 skill 的覆盖关系通常是：

```text
project .claude
  > user .claude
  > project .agents
  > project .deepagents
  > user .agents
  > user .deepagents
  > built-in
```

CLI 的 `deepagents_cli.skills.load.list_skills()` 也使用同样的低到高顺序，并用 `all_skills[skill["name"]] = extended` 完成覆盖。

## 7. Label Tuple 与 source label

`SkillSource = str | tuple[str, str]`。

也就是说，每个 source 可以是：

- 裸路径：`"/skills/user/"`
- 二元 tuple：`("/repo/.claude/skills", "Project Claude")`

tuple 的第二个元素是显示 label。它会渲染成：

```text
**Project Claude Skills**: `/repo/.claude/skills`
```

相关函数：

- `_validate_tuple_source()`
- `_source_path()`
- `_derive_source_label()`
- `SkillsMiddleware._format_skills_locations()`

为什么需要 label tuple：

- 很多 source 的叶子目录都叫 `skills`。
- 如果只从路径推导 label，`~/.agents/skills`、`.agents/skills`、`~/.claude/skills`、`.claude/skills` 很容易显示成相同或含糊的 label。
- CLI 因此显式传 tuple，把它们区分为 `User Agents`、`Project Agents`、`User Claude`、`Project Claude`。

裸路径的 label 推导规则：

- 一般取路径最后一段并 `.capitalize()`。
- `built_in_skills` 特判为 `Built-in`。
- 叶子是 `skills` 时，尝试上升到父目录并 title-case，例如 `.claude/skills` 推导为 `Claude`。
- 空路径或根路径退化为 `Unnamed`。

CLI 还有兼容逻辑：

- `deepagents/libs/cli/deepagents_cli/agent.py` 会检测 SDK 是否导出 `SkillSource`。
- 老 SDK 不支持 tuple 时，CLI 会把 tuple 降级成裸路径列表。
- 这样功能仍可用，只是 source label 的区分能力退回旧行为。

## 8. 缓存、错误与状态更新逻辑

### SDK middleware 缓存

`SkillsMiddleware.before_agent()` / `abefore_agent()` 只在 state 没有 `skills_metadata` 时加载。

如果某个 source 不存在或不可读：

- `_list_skills_with_errors()` 会返回 `source_error`。
- middleware 把错误写入 `skills_load_errors`。
- `modify_request()` 会通过 `_format_skills_load_warnings()` 把 warning 注入 system prompt。

warning 注入有防 prompt injection 的处理：

- 包在 `<skill_load_warnings>` 里。
- 明确声明它们是 untrusted diagnostics。
- 通过 `json.dumps()` 和 `html.escape()` 转义。
- 单条 warning 最长 1000 字符，最多显示 20 条。

### CLI command 缓存

CLI 的 `/skill:<name>` 不直接读取 middleware state，而是维护自己的发现缓存：

- `_discovered_skills`
- `_skill_allowed_roots`

启动或 reload 时 `_discover_skills()` 调用 `discover_skills_and_roots()`，缓存 metadata 和允许读取的根目录。调用 `/skill:name` 时 `_invoke_skill()` 先从缓存找；找不到再重新 discovery。

读取完整内容时使用：

- `load_skill_content(skill_path, allowed_roots=...)`

它会检查 resolved path 是否位于允许根目录下，避免 symlink traversal 读到技能目录外的文件。`settings.get_extra_skills_dirs()` 可以扩展允许根。

## 9. 与 FilesystemMiddleware / backend 的关系

SkillsMiddleware 和 FilesystemMiddleware 都依赖 backend，但职责不同：

- `SkillsMiddleware`：启动前扫描 sources，解析 `SKILL.md` frontmatter，给 system prompt 暴露 catalog。
- `FilesystemMiddleware`：给 agent 注册 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`execute` 等工具。

两者的关键连接点是 `read_file`：

- SkillsMiddleware 在 system prompt 中告诉模型：某个 skill 的全文在 `skill["path"]`。
- 真正读取这个 path 的工具来自 FilesystemMiddleware。
- 因此 backend 必须让 SkillsMiddleware 看到的 skill path，也能被 FilesystemMiddleware 的 `read_file` 读到。

在 `create_deep_agent()` 中，main agent middleware 顺序是：

1. `TodoListMiddleware`
2. 可选 `SkillsMiddleware`
3. `FilesystemMiddleware`
4. `SubAgentMiddleware`
5. summarization / patch tool calls 等

这保证模型收到 Skills system prompt 时，也有 `read_file` 工具可用。

backend 的用法要按场景区分：

- SDK 默认 `StateBackend`：skills 要通过 `invoke(files={...})` 或类似机制提前放入 backend。
- `FilesystemBackend(root_dir=...)`：skills 从磁盘读，路径相对 root 或使用绝对路径。
- `CompositeBackend`：可以把 `/skills/` 路由到一个专门 backend，把其他文件路由到 state 或工作目录。
- sandbox backend：可以在 sandbox 创建时上传 `/skills/.../SKILL.md`，再让 agent 在 sandbox 内读取和编辑。

典型 examples：

- `deepagents/examples/text-to-sql-agent/agent.py`
  - `backend=FilesystemBackend(root_dir=base_dir)`
  - `skills=["./skills/"]`
- `deepagents/examples/content-builder-agent/content_writer.py`
  - `backend=FilesystemBackend(root_dir=EXAMPLE_DIR)`
  - `skills=["./skills/"]`
- `deepagents/examples/nvidia_deep_agent/src/backend.py`
  - `_seed_sandbox()` 上传本地 skills 到 `/skills/<name>/SKILL.md`
  - subagent 使用 `skills=["/skills/"]`
- `deepagents/examples/repl_swarm/swarm_agent.py`
  - `CompositeBackend(routes={"/skills/": skill_backend})`
  - `skills=["/skills/"]`
  - `REPLMiddleware(skills_backend=backend)` 复用同一 backend 加载 skill module

需要特别注意：SkillsMiddleware 只解析 `SKILL.md` 元数据，不负责暴露 `read_file`，也不负责执行 skill 脚本。读取和执行分别依赖 FilesystemMiddleware 的 `read_file` / `execute`，或者 CLI `/skill` 的直接文件读取路径。

## 10. CLI skills source 组装逻辑

CLI agent 创建入口在 `deepagents/libs/cli/deepagents_cli/agent.py` 的 `create_cli_agent()`。

当 `enable_skills=True`：

1. `settings.ensure_user_skills_dir(assistant_id)` 确保 `~/.deepagents/<assistant_id>/skills/` 存在。
2. 读取共享 user skills：`settings.get_user_agent_skills_dir()`，即 `~/.agents/skills/`。
3. 读取 project skills：`.deepagents/skills/` 和 `.agents/skills/`。
4. 读取 built-in skills：`settings.get_built_in_skills_dir()`。
5. 如果存在，加入 experimental Claude skills：`~/.claude/skills/` 和 `.claude/skills/`。
6. 按低到高 precedence 传给 `SkillsMiddleware(backend=FilesystemBackend(), sources=middleware_sources)`。

目录函数在 `deepagents/libs/cli/deepagents_cli/config.py`：

- `get_user_skills_dir()`
- `ensure_user_skills_dir()`
- `get_project_skills_dir()`
- `get_user_agent_skills_dir()`
- `get_project_agent_skills_dir()`
- `get_user_claude_skills_dir()`
- `get_project_claude_skills_dir()`
- `get_built_in_skills_dir()`
- `get_extra_skills_dirs()`

CLI 命令层和 middleware 层有两套 discovery：

- agent runtime 用 `SkillsMiddleware` 注入 catalog。
- UI slash command 用 `deepagents_cli.skills.load.list_skills()` 建 autocomplete 和 `/skill:name` 快速调用。

两者都复用 SDK 内部 `_list_skills()` / `_list_skills_with_errors()` 的解析能力，避免重复实现 frontmatter 解析规则。

## 11. Examples 中的 skills 使用方式

### text-to-sql-agent

`deepagents/examples/text-to-sql-agent/agent.py`：

- `memory=["./AGENTS.md"]`
- `skills=["./skills/"]`
- `backend=FilesystemBackend(root_dir=base_dir)`

README 明确说明：agent 只先看到 skill descriptions，当前任务需要时才加载完整 `SKILL.md`。这是最标准的 progressive disclosure 示例。

### content-builder-agent

`deepagents/examples/content-builder-agent/content_writer.py`：

- skills 放在 `skills/blog-post/SKILL.md` 和 `skills/social-media/SKILL.md`。
- `create_deep_agent(..., skills=["./skills/"], backend=FilesystemBackend(root_dir=EXAMPLE_DIR))`。
- README 把 `AGENTS.md` 解释为启动加载，把 `skills/*/SKILL.md` 解释为按需 workflow。

### nvidia_deep_agent

`deepagents/examples/nvidia_deep_agent/src/backend.py` 会把本地 `skills/` 上传到 sandbox 的 `/skills/`。

`deepagents/examples/nvidia_deep_agent/src/agent.py` 中 data processor subagent 设置：

```python
"skills": ["/skills/"]
```

这个例子体现了 skills 与 backend 生命周期的关系：skills 不一定来自本机磁盘，也可以先 seed 到远端 sandbox，然后 middleware 从 sandbox backend 扫描，模型再用 sandbox 内的 `read_file` / `edit_file` 读写。

### repl_swarm

`deepagents/examples/repl_swarm/swarm_agent.py` 使用：

- `CompositeBackend(default=StateBackend(), routes={"/skills/": skill_backend})`
- `skills=["/skills/"]`
- `REPLMiddleware(skills_backend=backend)`

`skills/swarm/SKILL.md` 包含：

```yaml
module: ./index.ts
```

这里 `SkillsMiddleware` 负责解析 `module` metadata；真正把 `@/skills/swarm` 解析成 ES module 的是 REPL middleware。这个例子展示了 skills 不只是 markdown 工作流，也可以作为可导入代码模块的分发单元。

## 12. 重要源码路径

SDK middleware：

- `deepagents/libs/deepagents/deepagents/middleware/skills.py`
  - `SkillsMiddleware`
  - `SkillsState`
  - `SkillMetadata`
  - `_list_skills_with_errors()`
  - `_alist_skills_with_errors()`
  - `_parse_skill_metadata()`
  - `_validate_skill_name()`
  - `_derive_source_label()`
  - `SKILLS_SYSTEM_PROMPT`
- `deepagents/libs/deepagents/deepagents/graph.py`
  - `create_deep_agent()`
  - skills 参数文档
  - main agent 和 general-purpose subagent 的 middleware 组装
- `deepagents/libs/deepagents/deepagents/middleware/filesystem.py`
  - `FilesystemMiddleware`
  - `_create_read_file_tool()`
- `deepagents/libs/deepagents/deepagents/backends/filesystem.py`
  - `FilesystemBackend`
- `deepagents/libs/deepagents/deepagents/backends/composite.py`
  - `CompositeBackend`

CLI：

- `deepagents/libs/cli/deepagents_cli/agent.py`
  - `create_cli_agent()`
  - skills sources precedence
  - tuple label compatibility fallback
- `deepagents/libs/cli/deepagents_cli/config.py`
  - skills 目录解析函数
- `deepagents/libs/cli/deepagents_cli/skills/load.py`
  - CLI discovery 和 direct content loading
- `deepagents/libs/cli/deepagents_cli/skills/invocation.py`
  - `/skill` prompt envelope
- `deepagents/libs/cli/deepagents_cli/app.py`
  - `_discover_skills()`
  - `_invoke_skill()`
  - `_handle_skill_command()`
- `deepagents/libs/cli/deepagents_cli/command_registry.py`
  - `/skill:<name>` autocomplete 和 parser

Examples：

- `deepagents/examples/text-to-sql-agent/agent.py`
- `deepagents/examples/content-builder-agent/content_writer.py`
- `deepagents/examples/nvidia_deep_agent/src/backend.py`
- `deepagents/examples/nvidia_deep_agent/src/agent.py`
- `deepagents/examples/repl_swarm/swarm_agent.py`
- `deepagents/examples/repl_swarm/skills/swarm/SKILL.md`

Tests / snapshots：

- `deepagents/libs/deepagents/tests/unit_tests/middleware/test_skills_middleware.py`
- `deepagents/libs/deepagents/tests/unit_tests/middleware/test_skills_middleware_async.py`
- `deepagents/libs/cli/tests/unit_tests/test_agent.py`
- `deepagents/libs/cli/tests/unit_tests/skills/test_load.py`
- `deepagents/libs/deepagents/tests/unit_tests/smoke_tests/snapshots/system_prompt_with_memory_and_skills.md`

## 13. 建议读源码顺序

1. 先读 `skills.py` 顶部 docstring，建立 sources、SkillMetadata、progressive disclosure 的整体模型。
2. 读 `SkillMetadata` / `SkillsState` / `SkillsStateUpdate`，理解 state 和 metadata 结构。
3. 读 `_parse_skill_metadata()` 和 `_validate_skill_name()`，理解 `SKILL.md` 规范如何落到代码。
4. 读 `_list_skills_with_errors()`，把 backend.ls、download_files、parse 串起来。
5. 读 `before_agent()` / `abefore_agent()`，理解加载一次、last-one-wins、state update。
6. 读 `SKILLS_SYSTEM_PROMPT`、`_format_skills_locations()`、`_format_skills_list()`、`modify_request()`，理解 prompt 如何生成。
7. 跳到 `graph.py` 看 `create_deep_agent()` 的 middleware 顺序，尤其是 SkillsMiddleware 和 FilesystemMiddleware 的关系。
8. 读 CLI `agent.py` 的 source 组装，理解 built-in/user/project/Claude 的 precedence 和 label tuple。
9. 读 CLI `skills/load.py`、`skills/invocation.py`、`app.py::_invoke_skill()`，理解 `/skill:name` 与模型自主 `read_file` 的差异。
10. 最后读 examples，尤其是 text-to-sql、content-builder、nvidia_deep_agent、repl_swarm。

## 14. 关键问题清单

学习或修改 SkillsMiddleware 时建议带着这些问题读：

- source path 是 backend path，还是本机真实路径？当前 backend 的 `root_dir` / `virtual_mode` 会如何解释它？
- `SkillsMiddleware` 看到的 `skill["path"]`，`FilesystemMiddleware.read_file` 是否也能读到？
- 同名 skill 出现在多个 source 时，预期谁覆盖谁？
- 是否需要 tuple label，避免多个 `skills` 叶子目录在 prompt 中显示混乱？
- 如果 source 不存在，是希望静默跳过，还是把 warning 暴露给模型？
- `skills_metadata` 已经在 state 里时，是否需要重新扫描？如果需要，刷新入口在哪一层实现？
- CLI `/skill:name` 是用户强制调用，不等同于模型根据 catalog 自主选择；交互语义是否符合产品需求？
- skill 里有脚本时，agent 是否拥有 `execute` 工具？backend 是否支持 execution？
- skill 里有图片、PDF 或二进制文件时，`read_file` 的返回和展示路径是否符合预期？
- symlink、绝对路径、`../`、远端 sandbox 路由是否会造成读取不到或越界读取？
- `module` 字段只是 metadata；真正消费它的 middleware 是否已经配置，例如 REPLMiddleware？
- `allowed_tools` 目前只是展示性 metadata，是否被真正强制执行？当前 SkillsMiddleware 不做强制权限控制。

## 15. 小结

`SkillsMiddleware` 是 DeepAgents 中把“长期可复用工作流”接入模型上下文的轻量 catalog 层。它通过 backend 扫描 skill sources，解析 `SKILL.md` frontmatter，把可用技能列表注入 system prompt，并把完整内容的加载留给 `read_file` 或 CLI `/skill`。它本身不执行脚本、不注册文件工具、不强制 allowed tools；真正的文件读取、写入、执行能力来自 FilesystemMiddleware 和 backend。

理解它时最重要的是三条线：

- 数据线：`sources -> SKILL.md frontmatter -> SkillMetadata -> state`
- prompt 线：`state -> SKILLS_SYSTEM_PROMPT -> model sees catalog`
- 内容线：`catalog path -> read_file / CLI load_skill_content -> full SKILL.md`

这三条线分清后，source precedence、label tuple、backend routing 和 examples 里的不同部署方式都会变得比较直接。
