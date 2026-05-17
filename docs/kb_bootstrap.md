# KB Bootstrap for Agents

This is the shortest agent-facing entrypoint for using `kb` from this repository.

The user should only need to say something like:

```text
请查看 git@github.com:qzzqzzb/InternAgents.git 里的 docs/kb_bootstrap.md，按照里面的流程帮我配置 kb。
```

After receiving that instruction, do not ask the user for more details upfront. First execute the bootstrap discovery flow below, then ask only for the specific missing input reported by `kb bootstrap`.

## 1. Clone and install this repository

If this repository is not already present locally:

```bash
git clone git@github.com:qzzqzzb/InternAgents.git
cd InternAgents
```

If it is already present, enter the existing checkout.

Install the local CLI:

```bash
npm install
npm link
kb --help
kb doctor --skip-kb --json
```

If `python3`, `git`, or `PyYAML` is missing, report the missing dependency and stop.

## 2. Inspect bootstrap state before asking the user questions

Run:

```bash
kb bootstrap --json
```

Read `data.status`, `data.actions`, and `data.agent_message`.

Do not invent the next step. Follow the returned `data.actions`.

Common states:

- `needs_repo_url`: tell the user they need a Git repository for the KB and ask them to provide the SSH/HTTPS repo URL. Also mention that local-only testing is available if they do not want a remote yet.
- `ready_to_attach`: run the attach command from `data.actions`.
- `local_kb_found`: record attachment, validate config, and list domains.
- `attached`: validate config, list domains, and inspect sync status.

## 3. What to say when `needs_repo_url`

If `kb bootstrap --json` returns `needs_repo_url`, ask the user exactly for the missing repository URL. A good response is:

```text
我已经检查了 kb 的本地状态。现在还缺一个用于同步知识库的 Git 仓库地址。

请创建一个空的私有 Git 仓库（GitHub/GitLab/Gitea 都可以），然后把 SSH 或 HTTPS 地址发给我，例如：
git@github.com:<owner>/<kb-repo>.git

如果你只是想先本地测试，我也可以不使用远端仓库，直接初始化本地 .research-kb。
```

Do not ask for tokens or passwords. If authentication fails later, tell the user to configure machine-level Git credentials.

## 4. After the user provides a KB Git URL

Use the URL the user gives you. Example placeholder: `<KB_GIT_URL>`.

```bash
kb bootstrap --repo <KB_GIT_URL> --path .research-kb --json
kb attach --repo <KB_GIT_URL> --path .research-kb --clone --init-if-missing --json
kb config validate --json
kb domain list --json
kb sync status --fetch --json
```

If Git authentication fails, tell the user the machine needs Git credentials configured for that repo. Do not ask them to paste tokens into chat.

## 5. If the user chooses local-only testing

```bash
kb init --path .research-kb --json
kb attach --path .research-kb --json
kb config validate --json
kb domain list --json
```

## 6. After setup

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
- Do not ask the user for repo URL until after running `kb bootstrap --json`.
- Do not guess domain names or field names; inspect `kb domain list/schema`.
- Do not store credentials in prompts, `kb.yaml`, or attachment files.
- Do not edit `kb.yaml` unless the user asks you to configure domains.
- On failure, inspect `error.code`, `error.details`, and `error.suggested_commands`.
