# KB Bootstrap for Agents

This is the shortest agent-facing entrypoint for using `kb` from this repository.

If a user says: "Use kb" or "Help me configure kb", follow this protocol.

## 1. Install the local kb CLI

From this repository checkout:

```bash
npm install
npm link
kb --help
kb doctor --skip-kb --json
```

If `python3`, `git`, or `PyYAML` is missing, report the missing dependency and stop.

## 2. Inspect bootstrap state

Run:

```bash
kb bootstrap --json
```

Read `data.status`, `data.actions`, and `data.agent_message`.

Common states:

- `needs_repo_url`: ask the user for a private Git repository URL for the KB, or offer local-only initialization.
- `ready_to_attach`: run the attach command from `data.actions`.
- `local_kb_found`: record attachment, validate config, and list domains.
- `attached`: validate config, list domains, and inspect sync status.

## 3. If the user provides a KB Git URL

Use the URL the user gives you. Example placeholder: `<KB_GIT_URL>`.

```bash
kb bootstrap --repo <KB_GIT_URL> --path .research-kb --json
kb attach --repo <KB_GIT_URL> --path .research-kb --clone --init-if-missing --json
kb config validate --json
kb domain list --json
kb sync status --fetch --json
```

If Git authentication fails, tell the user the machine needs Git credentials configured for that repo. Do not ask them to paste tokens into chat.

## 4. If the user wants local-only testing

```bash
kb init --path .research-kb --json
kb attach --path .research-kb --json
kb config validate --json
kb domain list --json
```

## 5. After setup

Before writing records, discover the domain contract:

```bash
kb domain list --json
kb domain schema <domain> --json
```

Append records through the generic domain API:

```bash
kb domain append --domain <domain> --field key=value --json
```

Retrieve with bounded commands:

```bash
kb tree --domain <domain> --max-depth 3 --limit 200 --json
kb grep <query> --domain <domain> --context 2 --limit 10 --json
kb read <path> --range 1:120 --json
```

Sync with:

```bash
kb sync status --fetch --json
kb sync pull --fetch --json
kb sync push --dry-run --json
kb sync push --json
```

## Rules

- Always use `--json` for commands you parse.
- Do not guess domain names or field names; inspect `kb domain list/schema`.
- Do not store credentials in prompts, `kb.yaml`, or attachment files.
- Do not edit `kb.yaml` unless the user asks you to configure domains.
- On failure, inspect `error.code`, `error.details`, and `error.suggested_commands`.
