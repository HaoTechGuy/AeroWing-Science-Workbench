# KB Bootstrap Guide

This guide defines how a human or agent starts from a Git knowledge-base repository URL and reaches a configured local `.research-kb` attachment.

## Goal

Given:

- a machine with Git credentials already configured;
- this `kb` client checkout;
- a private knowledge-base Git URL;

an agent should be able to clone/attach the KB, create missing config when needed, validate the result, and list the configured domains.

## One-Command Attach

```bash
./bin/kb attach \
  --repo git@github.com:YOUR_ORG/YOUR_PRIVATE_KB.git \
  --path .research-kb \
  --clone \
  --init-if-missing \
  --json
```

Behavior:

1. If `.research-kb` does not exist, clone `--repo` into it.
2. If `.research-kb` exists, require it to be a Git repo or a valid KB path.
3. If `kb.yaml` is missing and `--init-if-missing` is set, create the default `kb.yaml` and domain directories.
4. Write `.kb-attachment.json` in the current project.
5. Do not commit, push, or store credentials.

## Validation

```bash
./bin/kb config validate --json
./bin/kb domain list --json
./bin/kb status --json
```

The agent should stop and report a blocker if:

- Git authentication fails;
- the path already exists but is not safe to use;
- `kb.yaml` exists but is invalid;
- a requested domain is missing.

## Private Repo Credentials

`kb` does not manage secrets. Use the machine's normal Git credential setup:

- SSH key for `git@...` URLs;
- credential helper or token for HTTPS URLs.

Do not put tokens in `kb.yaml`, prompt text, or attachment files.

## Agent Prompt Template

```text
Use the kb client in this repository.
Knowledge-base repo: <PRIVATE_GIT_URL>
Attach path: .research-kb
Run attach with --clone and --init-if-missing.
Then validate config and list domains.
Do not commit or push.
Report exact commands and JSON result summaries.
```
