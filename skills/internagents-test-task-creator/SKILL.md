---
name: internagents-test-task-creator
description: Create realistic InternAgents end-to-end browser test example workspaces under the project's .internagents/test-examples directory. Use when Codex needs to design or scaffold numbered test tasks that exercise InternAgents core workflows such as literature reading, code execution, experiment/report generation, workspace browsing, approval flows, and skill creation. Also use when converting a high-level capability or existing example into a README-driven task that can later be executed only through the InternAgents frontend and Codex in-app browser.
---

# InternAgents Test Task Creator

## Purpose

Create numbered test example workspaces for InternAgents browser-driven end-to-end testing. The default output root is `.internagents/test-examples` relative to the current project root. Each generated task should be a self-contained directory such as `.internagents/test-examples/03_skill_creation_workflow` with a concise `README.md`, optional starter files, and clear frontend-verifiable success criteria.

This skill creates test tasks; it does not execute them. Execution is handled later by an agent using the in-app Browser and the InternAgents frontend.

## Workflow

1. Identify the capability under test:
   - literature reading and comparison
   - code execution or data analysis
   - file creation, editing, and preview
   - skill creation or skill marketplace behavior
   - workspace switching and file browsing
   - approvals, tool calls, stream continuity, or error handling

2. Pick the next numbered example name:
   - Prefer `NN_short_snake_case`.
   - If the user provides a number, use it.
   - If creating under `.internagents/test-examples`, inspect only directory names needed to choose the next number. Do not read private task contents unless the user supplied that path as an example to learn from.

3. Write a README-driven task:
   - One short scenario paragraph.
   - A `Files` section listing visible starter files.
   - A `Task` section written as instructions for the user to give InternAgents.
   - A `Success criteria` section that can be verified from the browser UI: conversation answer, workspace file list, file preview, or visible command output.
   - A `Restrictions` section for what the test must not do.

4. Add starter files only when they make the workflow realistic:
   - For paper-reading tasks, include PDFs or text placeholders only when the user provides source files or approves generated fixtures.
   - For code tasks, include a small script, dataset, notebook, or test file.
   - For skill-creation tasks, include a minimal brief and expected skill requirements; do not pre-create the final skill.

5. Keep the task frontend-testable:
   - Require InternAgents to act through its own workspace tools.
   - Make outputs observable through file list, preview, or chat reply.
   - Avoid hidden oracle checks that require local filesystem inspection.

6. After creating or updating an example, provide:
   - the example path
   - the intended capability coverage
   - the exact prompt a browser-test runner should send to InternAgents
   - any fixtures created

## Use The Scaffold Script

Use `scripts/create_example.py` for routine creation. It writes a new example directory and starter files from built-in templates.

Run from the project root:

```bash
python skills/internagents-test-task-creator/scripts/create_example.py --kind coding --slug toy_ml_experiment
```

Use `--root` to override the default `.internagents/test-examples` output directory.

Useful kinds:

- `paper`: compare multiple papers or documents without editing source files.
- `coding`: run or modify code and produce a report or result file.
- `skill`: ask InternAgents to create a skill from a brief.
- `mixed`: combine workspace browsing, code execution, and report creation.

Read `references/task-design.md` when designing a custom task or when the user asks for a new category not covered by the script.

Read `references/browser-execution-contract.md` when the test task must be compatible with the existing browser automation pipeline.

## Design Rules

- Test real InternAgents behavior, not local Codex shortcuts.
- Require frontend-visible confirmation for completion.
- Do not include secrets, real hosts, private SSH details, API keys, or user-specific machine credentials.
- Do not require changing InternAgents source code or Git branches.
- Do not make bug reporting the primary success path; bug evidence belongs under the execution pipeline's configured bug-output directory only when execution later discovers a bug.
- Prefer small, deterministic fixtures so repeated browser tests are stable.
- Make tasks challenging enough to exercise tool use, but not so broad that success depends on model taste alone.

## Example Task Shapes

Paper-reading:

```markdown
# Multi-paper Agent Reading

You are preparing a group meeting on LLM agents, tool use, and skill accumulation.

Files:
- papers/react.pdf
- papers/toolformer.pdf
- papers/voyager.pdf

Task:
Use InternAgents to compare the papers. Produce a concise comparison table and a meeting brief. Do not edit the source PDFs.

Success criteria:
- The chat answer summarizes all listed papers.
- A generated `meeting_brief.md` is visible in the workspace file list and previewable.
```

Coding:

```markdown
# Toy ML Experiment

Task:
Run the provided Python experiment, inspect the output, fix any obvious issue, and create `experiment_report.md`.

Success criteria:
- The run completes through InternAgents.
- `experiment_report.md` explains the command, observed metrics, and any code change.
```

Skill creation:

```markdown
# Skill Creation Workflow

Task:
Create a new skill from `brief.md`, validate its structure, and summarize how it should be invoked.

Success criteria:
- A skill folder with `SKILL.md` exists in the workspace.
- The chat response names the skill and its trigger behavior.
```
