# Browser Execution Contract

Generated examples should be compatible with a later browser-only execution pipeline.

## Assumptions For The Runner

- The runner uses the Codex in-app Browser, not system-level UI automation.
- The runner switches workspaces through the InternAgents UI, normally the top-left workspace switcher.
- The runner observes files, README content, chat responses, approvals, and previews through the frontend.
- The runner does not directly inspect or modify example workspace files through shell, Python, PowerShell, Node fs, or local filesystem APIs.

## Constraints To Preserve In Tasks

- Do not require changing InternAgents source code.
- Do not require switching Git branches.
- Do not require reading files outside the current example workspace.
- Do not require external network access unless the user explicitly wants a network test.
- Make completion visible through the frontend.

## Bug Evidence Expectations

When later execution finds a frontend-visible bug, evidence should go under the test pipeline's configured bug-output directory, for example `.internagents/bug-reports`, and include:

- `screenshot.png` from the in-app browser or Playwright.
- `browser_console.jsonl`.
- `browser_network.jsonl`.
- relevant `ui_server.log`, `agent_server.log`, and `runtime_server.log` excerpts from `.internagents/logs` when available.
- `visible_error.txt`.
- `dom_snapshot.txt`.
- `bug_report.md` with severity, reproduction steps, logs gathered, and missing-log reasons.

Task examples should not create bug folders proactively.
