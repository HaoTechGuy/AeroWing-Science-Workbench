# KB Agent Guide

Use this guide when an AI agent needs to install, attach, inspect, write to, or sync a `kb` knowledge repository.

## Core Rules

- Always pass `--json` for commands whose output you will parse.
- Treat stdout as data and stderr as logs.
- On failure, inspect `error.code`, `error.details`, and `error.suggested_commands`.
- Do not guess team-specific paths or record fields; discover domains from `kb.yaml` through `kb` commands.
- Do not store credentials in prompts, `kb.yaml`, or attachment files.
- Do not edit `kb.yaml` unless the user asks you to configure domains.
- Run `kb sync status --fetch --json` before pull or push when a remote is configured.

## Bootstrap

When the user says they want to use kb, start with:

```bash
kb bootstrap --json
```

Read `data.status`, `data.actions`, and `data.agent_message`. Use them to tell the user the next required step.

Common states:

- `needs_repo_url`: ask the user to create/provide a private Git repository URL, or offer local-only initialization.
- `ready_to_attach`: run the attach command from `data.actions`.
- `local_kb_found`: record attachment, validate config, and list domains.
- `attached`: validate config, list domains, and inspect sync status.

Given a private KB Git URL and a desired attach path:

```bash
kb bootstrap --repo <PRIVATE_GIT_URL> --path .research-kb --json
kb attach --repo <PRIVATE_GIT_URL> --path .research-kb --clone --init-if-missing --json
kb config validate --json
kb domain list --json
```

If `kb attach` fails due to authentication, report that the machine's Git credentials need to be configured. Do not ask the user to paste tokens into chat.

## Self-Discovery

Before using unfamiliar commands:

```bash
kb --help
kb schema --json
kb schema commands --json
kb schema domain --json
kb doctor --json
```

Before writing a domain record:

```bash
kb domain list --json
kb domain schema <domain> --json
```

Use the schema's `required_fields`, `optional_fields`, and `path_template` to decide which `--field key=value` arguments are needed.

## Retrieval Pattern

Prefer domain-scoped, bounded retrieval:

```bash
kb tree --domain <domain> --max-depth 3 --limit 200 --json
kb grep <query> --domain <domain> --context 2 --limit 10 --json
kb read <path> --range 1:120 --json
```

If no relevant domain is obvious, run `kb domain list --json` and choose by `description`.

## Writing Pattern

1. Validate config.
2. Discover domain.
3. Read domain schema.
4. Append with required fields.
5. Check status.

Example:

```bash
kb config validate --json
kb domain schema experiments --json
kb domain append \
  --domain experiments \
  --field project=demo \
  --field title="first run" \
  --field status=running \
  --json
kb status --json
```

`kb domain append` creates files but does not commit them.

## Sync Pattern

```bash
kb sync status --fetch --json
kb sync pull --fetch --json
kb sync push --dry-run --json
kb sync push --json
```

Current MVP does not enforce human review. Permission policy will be added later. Still prefer `--dry-run` before push when uncertain.

## Recovery Hints

| Error Code | Meaning | Typical Next Step |
|---|---|---|
| `KB_REPO_NOT_FOUND` | No attached KB found | Run `kb attach ...` |
| `KB_CONFIG_NOT_FOUND` | KB repo has no `kb.yaml` | Run attach/init with `--init-if-missing` if appropriate |
| `KB_CONFIG_INVALID` | Config validation failed | Inspect diagnostics and fix `kb.yaml` only if asked |
| `KB_DOMAIN_NOT_FOUND` | Requested domain is absent | Run `kb domain list --json` |
| `KB_DOMAIN_FIELD_REQUIRED` | Missing required record field | Run `kb domain schema <domain> --json` |
| `KB_WORKTREE_DIRTY` | Pull/push blocked by local changes | Run `kb status --json`; commit/stash only if asked |
| `GIT_OPERATION_FAILED` | Git command failed | Report stderr summary and likely credential/remote issue |
