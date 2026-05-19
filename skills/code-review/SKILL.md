---
name: code-review
description: Review code changes for correctness, regressions, maintainability, tests, and security-sensitive behavior.
---

# Code Review

Use this skill when the user asks for a review, risk check, regression check,
or pre-merge inspection.

## Review Priorities

1. Behavioral bugs and user-visible regressions.
2. Incorrect state management, async behavior, or API contracts.
3. Missing tests around changed behavior.
4. Security-sensitive file, shell, network, or credential handling.
5. Maintainability issues only when they create real future risk.

## Output

Lead with findings ordered by severity. Include file and line references when
possible. If there are no issues, say that clearly and mention remaining test
gaps or residual risk.
