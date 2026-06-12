# Task Design Reference

## Required README Structure

Every generated example should contain a `README.md` with these sections:

- Title: concise capability-focused name.
- Scenario: why a real user would ask for this.
- Files: visible fixtures in the workspace.
- Task: the exact work InternAgents should perform.
- Success criteria: browser-visible checks.
- Restrictions: actions the test runner or InternAgents should avoid.

## Capability Coverage

Use one primary capability and one secondary capability per example.

Good combinations:

- Literature reading + report generation.
- Code execution + file creation.
- Skill creation + validation.
- Workspace browsing + file preview.
- Approval flow + command execution.

Avoid examples that only ask for a chat answer without using workspace context, unless the task specifically targets reading or summarization.

## Fixture Guidelines

- Keep fixtures small and deterministic.
- Use synthetic data for coding tasks.
- Use short markdown or text fixtures when PDF assets are unavailable.
- Do not include secrets, real credentials, private SSH aliases, API keys, or machine-specific paths inside fixtures.
- When a task needs large assets, state that the user must provide them rather than generating fake large files.

## Success Criteria Examples

Good:

- `analysis_report.md` appears in the workspace file list and its preview contains a methods section.
- The chat response includes a comparison table covering all listed documents.
- The generated skill folder includes `SKILL.md` with valid YAML frontmatter.

Weak:

- The answer is good.
- The agent understands the task.
- Check the local file manually.

## Prompt To Send During Browser Execution

The generated README should include or imply a concise user prompt. Prefer this shape:

```text
Please read the workspace README and complete the task using the files in this workspace. Confirm the final outputs through the workspace file list or preview.
```

When the task needs stricter behavior, include the target file names directly.
