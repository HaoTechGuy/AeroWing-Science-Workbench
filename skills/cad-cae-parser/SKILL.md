---
name: cad-cae-parser
description: "航空 CAD/CAE 文件解析插件骨架：解析 Nastran BDF/DAT、Abaqus INP、STL、VTK/VTU 等结构模型文件并输出统一 JSON 摘要，供空中之翼进行模型审查和报告生成。"
version: "0.1.0"
user-invocable: true
argument-hint: "<模型文件路径> [--json 输出路径]"
allowed-tools: Read, Write, Grep, Glob, Bash
---

# CAD/CAE 文件解析插件

当用户上传或指定航空结构 CAD/CAE 文件时，优先使用本技能进行轻量解析，生成统一的 `AeroWingModel` JSON 摘要，再交给航空结构分析技能进行审查。

## 当前支持

- Nastran Bulk Data：`.bdf`, `.dat`, `.nas`
- Abaqus input：`.inp`
- STL：`.stl`
- VTK legacy/XML：`.vtk`, `.vtu`, `.vtp`, `.vti`
- 通用文本结果：`.f06`, `.pch`, `.csv`, `.txt`

## 工具

```bash
python skills/cad-cae-parser/tools/parse_cae_file.py <file> --json outputs/model-summary.json
```

输出字段：

- `metadata`: 文件名、扩展名、大小、解析器版本。
- `geometry`: STL/几何类文件的三角面片等摘要。
- `mesh`: 节点、单元、单元类型、集合/部件统计。
- `materials`: 材料卡片或材料段摘要。
- `loads`: 载荷、约束、工况关键字摘要。
- `results`: 文本结果文件中的常见结果标记。
- `checks`: 缺失材料、孤立统计、未知格式等风险提示。

## 解析后审查建议

1. 先确认单位和坐标系是否能从文件或项目说明中获得。
2. 对 BDF/INP 检查节点、单元、属性、材料、载荷和约束是否成体系。
3. 对 STL/VTK 说明它们多用于几何/网格/可视化，不一定包含材料和载荷。
4. 输出问题清单时按 `高/中/低` 风险分级。