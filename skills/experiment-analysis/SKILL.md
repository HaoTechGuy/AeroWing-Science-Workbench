---
name: experiment-analysis
description: Analyze experiment logs, tables, metrics, and ablation results, then explain trends, anomalies, and next actions.
---

# Experiment Analysis

Use this skill when the user asks to inspect experimental results, compare
runs, diagnose metric changes, or plan the next experiment.

## Workflow

1. Locate the relevant result files, logs, tables, or plots.
2. Normalize the comparison axes: model, dataset, seed, hyperparameters,
   checkpoint, metric, and evaluation split.
3. Compare against the right baseline before drawing conclusions.
4. Look for anomalies such as missing runs, inconsistent seeds, regressions,
   unstable metrics, or suspiciously large gains.
5. Recommend the smallest next experiment that resolves the largest uncertainty.

## Output

Keep the answer structured and decision-oriented:

- 观察到什么
- 为什么可能发生
- 还不能确认什么
- 下一步最值得跑什么
