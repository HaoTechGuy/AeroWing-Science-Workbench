---
name: flight-condition-calculator
description: "航空飞行工况计算技能：基于 ISA 标准大气计算马赫数、速度、动压、雷诺数、升力系数需求和基础载荷工况。"
version: "0.1.0"
user-invocable: true
argument-hint: "altitude_m=<高度> mach=<马赫数> 或 speed_m_s=<速度>"
allowed-tools: Bash
---

# Flight Condition Calculator

当用户询问飞行高度、马赫数、动压、雷诺数、升力系数需求、载荷因子或初步气动/结构载荷工况时，优先使用本技能。

## 工程边界

- 默认使用 ISA 标准大气，适合概念设计和工程初筛。
- 需要用户或项目提供参考面积、参考长度、重量、单位体系和载荷因子。
- 不替代试飞、风洞、CFD 或正式载荷谱。

## 工具

```bash
python skills/flight-condition-calculator/tools/flight_condition.py --altitude-m 11000 --mach 1.4 --reference-length-m 30 --reference-area-m2 80 --weight-n 980000
```

输出 JSON：

- `atmosphere`: 温度、压力、密度、声速、动力黏度。
- `speed_m_s`, `mach`, `dynamic_pressure_pa`。
- `reynolds_number`。
- `required_lift_coefficient`。
- `notes`: 工程限制和复核提示。

## 建议回答格式

1. 列出输入和假设。
2. 给出大气参数、速度/马赫数、动压和雷诺数。
3. 若有重量和参考面积，给出所需升力系数。
4. 明确说明结果是初筛，不是正式适航结论。
