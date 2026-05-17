# kb

Use when the user asks an agent to use, configure, inspect, write to, or synchronize a Git-native research knowledge base through the local `kb` CLI.

## Protocol

1. Prefer `kb --help`, `kb schema --json`, and `docs/kb-agent-guide.md` for self-discovery.
2. Always use `--json` for parseable commands.
3. When the user says they want to use kb, run:
   ```bash
   kb bootstrap --json
   ```
   Follow `data.actions` and explain any `actor: user` action to the user.
4. Bootstrap from a Git URL with:
   ```bash
   kb bootstrap --repo <PRIVATE_GIT_URL> --path .research-kb --json
   kb attach --repo <PRIVATE_GIT_URL> --path .research-kb --clone --init-if-missing --json
   kb config validate --json
   kb domain list --json
   ```
5. Before writing, run:
   ```bash
   kb domain schema <domain> --json
   ```
6. Append records through the generic domain API, not hardcoded domain commands:
   ```bash
   kb domain append --domain <domain> --field key=value --json
   ```
7. Retrieve with bounded commands:
   ```bash
   kb tree --domain <domain> --max-depth 3 --limit 200 --json
   kb grep <query> --domain <domain> --context 2 --limit 10 --json
   kb read <path> --range 1:120 --json
   ```
8. Sync with:
   ```bash
   kb sync status --fetch --json
   kb sync pull --fetch --json
   kb sync push --dry-run --json
   kb sync push --json
   ```
9. Do not store credentials in `kb.yaml`, prompts, or attachment files.
10. Do not edit `kb.yaml` unless the user asks to configure domains.
11. On errors, inspect `error.code`, `error.details`, and `error.suggested_commands`.

## Notes

- `experiment`, `seminar`, `literature`, and similar concepts are configurable domains in `kb.yaml`, not first-class CLI commands.
- Current MVP does not enforce human review or permission policy.
- `kb domain append` creates files but does not commit them.
