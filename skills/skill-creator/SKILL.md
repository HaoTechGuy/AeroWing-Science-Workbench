---
name: skill-creator
description: Create or update InternAgent skills. Use this skill when the user wants InternAgent to create a reusable skill, turn a repeated workflow into a SKILL.md package, improve an existing skill, or decide what scripts, references, assets, and triggering description a skill should include.
---

# Skill Creator

Use this skill to create, improve, or review InternAgent skills.

InternAgent skills are reusable instruction packages. A skill is a directory that contains a required `SKILL.md` file and optional supporting resources:

```text
skill-name/
+-- SKILL.md
+-- scripts/
+-- references/
`-- assets/
```

## Creation Workflow

1. Understand the user's intent before writing files.
   - What recurring task should the skill help with?
   - When should InternAgent use this skill?
   - What inputs, outputs, tools, credentials, or external services are involved?
   - Are there examples, edge cases, or success criteria?

2. Choose the skill shape.
   - Use only `SKILL.md` for instruction-only workflows.
   - Add `scripts/` when repeated code, deterministic parsing, file conversion, or API calls would otherwise be rewritten each time.
   - Add `references/` for detailed documentation, schemas, policies, API notes, or long examples that should be loaded only when needed.
   - Add `assets/` for templates, sample files, images, or other files used to produce outputs.

3. Pick a stable skill name.
   - Use lowercase letters, digits, and hyphens only.
   - Keep the name short and specific.
   - Make the directory name match the `name` frontmatter value.

4. Write `SKILL.md`.
   - Include YAML frontmatter with `name` and `description`.
   - Put trigger guidance in `description`, because InternAgent uses it before loading the body.
   - Keep the body focused on procedures, constraints, examples, and how to use bundled resources.
   - Prefer clear, general guidance over one-off details copied from the current conversation.

5. Validate the result.
   - Confirm `SKILL.md` exists and frontmatter parses.
   - Confirm required fields are non-empty.
   - Confirm referenced files actually exist.
   - Run or syntax-check scripts when the skill includes them.
   - Test with at least one realistic user prompt when practical.

## Writing Guidance

Write skill descriptions that include both what the skill does and when it should trigger. A good description is specific enough to avoid accidental use, but explicit enough to trigger when the user phrases the request differently.

Good pattern:

```yaml
---
name: report-builder
description: Create structured research or experiment reports from notes, data files, logs, or previous chat context. Use when the user asks InternAgent to produce a reusable report, summarize experiment outcomes, compare runs, or turn raw project material into a polished document.
---
```

Avoid putting "when to use this skill" only in the body. If the trigger condition is not in `description`, InternAgent may not load the skill.

Keep `SKILL.md` concise. Move long API documentation, schemas, policies, or examples into `references/` and link them from the main file with clear instructions about when to read them.

## Safety And Maintainability

- Do not create skills that hide behavior from the user, exfiltrate data, capture credentials, or bypass authorization.
- Do not store secrets in a skill. Describe the required environment variable or configuration instead.
- Do not add unnecessary README, changelog, or installation guide files unless the user explicitly asks for them.
- Prefer updating an existing relevant skill over creating near-duplicates.
- If a skill is generated from a one-time workflow, generalize it so it remains useful outside the current thread.

## InternAgent Placement

For project-provided skills, place the skill as a first-level directory under `skills/`, for example:

```text
skills/my-skill/SKILL.md
```

For user-imported or generated runtime skills, prefer `.internagents/imported-skills/my-skill/` so generated content does not accidentally become repository source.

When a skill should be active by default, add its relative path to `skills.selected` in `deepagent.config.json`.
