# 空中之翼实施记录

本文件记录 `feat/aerowing-skill-routing` 分支按 `doc/空中之翼.md` 路线推进的阶段、实现内容、验证方式和提交点。

## 阶段 1：基础体验与 CAE 预览闭环

目标：

- 保持中文界面语言，不让设置页无感覆盖对话页语言。
- 保持文件树展开状态和右侧预览状态。
- 对 STL/VTK/BDF 等 CAE 文件提供右侧 3D Viewer、CAE 摘要、几何体检结果。
- 大 STL 预览进行降采样和缓存，避免前端长时间空白。

实现：

- 右侧 `WorkspaceViewer` 已接入 `cae-summary`、`cae-mesh`、`geometry-audit` API。
- `cad-cae-parser` 支持 BDF/OP2/INP/STL/VTK 的统一摘要和可渲染 mesh JSON。
- `aircraft-geometry-audit` 输出 CFD/FEM/3D 打印适用性、非流形边、退化三角、表面积、体积和 Markdown 报告。
- 文件右键菜单支持“打开”和“添加文件地址到对话框”。

验证：

- `python -X utf8 -m py_compile internagents/agent_graph.py internagents/aircraft_geometry_audit_tools.py`
- `npm exec eslint -- src/app/page.tsx src/app/components/ChatInterface.tsx src/app/components/WorkspaceExplorer.tsx src/app/hooks/useChat.ts src/providers/ChatProvider.tsx src/lib/i18n.ts`

提交：

- `8fa7f63 feat: improve AeroWing CAE skill routing`

## 阶段 2：航空专业 Skill 和 Agent 工具

目标：

- 把专业能力做成 Skill 和可由 Agent 调用的真实工具。
- 避免只靠自然语言提示，让模型能主动选择专业计算工具。

实现：

- 新增 `skills/flight-condition-calculator`。
- 新增 `skills/nastran-structure-review`。
- 新增 `internagents/aerowing_engineering_tools.py`，注册：
  - `calculate_flight_condition`
  - `review_nastran_structure`
  - `detect_aerowing_solvers`
  - `create_aerowing_case_skeleton`
- 更新 `deepagent.config.json`，默认启用航空结构、CAD/CAE 解析、几何审查、飞行工况、Nastran 审查技能。
- 更新系统身份为 `空中之翼 (AeroWing Science Workbench)`，并加入专家 Agent 模板。

验证计划：

- Python 编译检查。
- 命令行运行飞行工况脚本。
- 命令行运行 Nastran 审查脚本。
- 在对话中请求几何审查/飞行工况/Nastran 审查，检查模型是否选择对应工具。

## 阶段 3：异步 Job 与求解器适配基础

目标：

- 重任务不阻塞前端。
- 外部求解器先做检测和案例骨架，不自动运行重型仿真。

实现：

- 新增 `.internagents/jobs/<jobId>/` 文件系统 Job 结构。
- 新增 API：
  - `POST /api/jobs`
  - `GET /api/jobs/:jobId`
  - `GET /api/jobs/:jobId/logs`
  - `DELETE /api/jobs/:jobId`
- 新增 `scripts/aerowing-job-runner.mjs` 后台执行器。
- 新增 `GET /api/solvers/detect`。
- 设置页新增“求解器适配”入口，显示 SU2、OpenFOAM、CalculiX、Nastran、Abaqus、OptiStruct 检测状态。

验证计划：

- TypeScript lint。
- 调用 `/api/solvers/detect`。
- 创建一个 `flight_condition` Job 并轮询到 `succeeded`。

提交：

- `087d900 feat: add AeroWing engineering skills and job foundation`

## 阶段 4：专家 Agent 配置入口与最小编排基础

目标：

- 设置页提供专家 Agent 配置入口。
- 用户不需要手工注册子 Agent；内置模板写入 `deepagent.config.json`。
- 主控 Agent 通过 DeepAgents 的 `subagents` 参数获得专家模板。

实现：

- 新增 `GET /api/agents` 和 `PUT /api/agents`。
- 新增设置页“专家 Agent”卡片，可启用/禁用：
  - `geometry-audit-agent`
  - `flight-physics-agent`
  - `structure-review-agent`
  - `cfd-prep-agent`
  - `engineering-report-agent`
- 确认 `internagents/agent_graph.py` 中 `_thread_skill_subagents()` 会读取 `config.subagents` 并传给 `create_deep_agent()`。

验证计划：

- TypeScript lint。
- 访问 `/api/agents` 返回模板及启用状态。
- 设置页切换模板并保存后，确认 `deepagent.config.json` 的 `subagents` 更新。

## 阶段 5：求解器集成最小安全闭环

目标：

- 先做安全的仿真前处理入口，不自动执行重型或商业求解器。
- 支持生成 SU2/OpenFOAM/CalculiX/Nastran/Abaqus/OptiStruct 的工程目录骨架。

实现：

- 新增 `POST /api/cases/skeleton`。
- `create_aerowing_case_skeleton` Agent 工具和 API 使用同样的目录结构思想：
  - `cases/<caseName>/README.md`
  - `config.cfg` for SU2
  - `0/constant/system` for OpenFOAM
  - `model.inp` for CalculiX
  - 商业求解器只生成说明文件，不内置、不分发、不自动安装。

验证计划：

- TypeScript lint。
- 调用 API 生成 `cases/x59_su2/config.cfg`。
