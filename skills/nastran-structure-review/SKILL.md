---
name: nastran-structure-review
description: "Nastran 结构模型审查技能：读取 BDF/DAT/NAS/OP2/F06/PCH，检查材料、属性、载荷、约束、Case Control 和结果摘要风险。"
version: "0.1.0"
user-invocable: true
argument-hint: "<nastran-file>"
allowed-tools: Read, Bash
---

# Nastran Structure Review

当用户要求审查 Nastran 有限元模型、结构载荷、约束、材料、属性、OP2 结果或 F06 文本结果时，优先使用本技能。

## 当前能力

- BDF/DAT/NAS：优先使用 pyNastran 读取真实有限元模型。
- OP2：优先使用 pyNastran 读取位移、应力、模态等常见结果表。
- F06/PCH：轻量扫描常见结果标记。
- 生成风险等级、问题清单和工程建议。

## 工具

```bash
python skills/nastran-structure-review/tools/review_bdf.py examples/cae-samples/wing-panel.bdf
```

## 输出重点

- 节点、单元、单元类型、材料、属性、载荷、约束、子工况。
- 高风险：有单元无材料、有单元无属性、缺少约束。
- 中风险：无常见载荷、结果表为空、未知格式 fallback。
- 建议下一步：单位/坐标系确认、求解器 deck check、网格质量检查、载荷路径复核。
