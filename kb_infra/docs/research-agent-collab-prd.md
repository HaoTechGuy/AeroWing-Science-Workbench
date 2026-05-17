# Research Agent Collaboration PRD / MVP Scope

> Status: Draft 0.2  
> Parent architecture: `research-agent-collab-architecture.md`  
> Goal: define a configurable, domain-driven `kb` client for foundational knowledge operations and multi-end collaboration.

## 1. Product Thesis

科研团队需要的不是一组写死的科研命令，而是一个统一、可配置、可被人类和 agent 共用的 Git knowledge client。

The core product promise:

```text
A user defines knowledge domains in kb.yaml. The kb client provides stable repo, retrieval, domain-record, and change-submission primitives that work across those domains without hardcoding domain semantics into the client.
```

Examples:

- `experiments` can be one configured domain.
- `seminars` can be another configured domain.
- `literature`, `protocols`, `ideas`, `proposals`, or any lab-specific record type can be domains.
- The CLI should not need new top-level commands for each one.

## 2. Product Boundary

`kb` is a client and coordination layer, not a domain-specific experiment tracker or proposal system.

It owns:

- local/attached Git KB discovery;
- config validation;
- bounded structured retrieval;
- generic domain record creation/listing/reading;
- safe change staging/submission through Git branches;
- JSON contracts for agents and runtime backends;
- metadata breadcrumbs for multi-end traceability.

It does not own:

- hardcoded experiment lifecycle;
- hardcoded proposal document semantics;
- vector/RAG indexing;
- dataset/model storage;
- full forge/backend/runtime behavior;
- lab-specific ontology decisions.

## 3. Personas

| Persona | Need | MVP Success |
|---|---|---|
| Researcher | Configure how their lab records knowledge | Can define domains in `kb.yaml` and append/list records consistently |
| Built-in agent | Use one stable interface across teams | Can call JSON commands without knowing lab-specific paths |
| External agent | Avoid private backend coupling | Can use CLI primitives against any configured KB |
| Team maintainer | Review and govern knowledge changes | Can require domain rules and branch-based review before merge |

## 4. Non-Negotiable Invariants

- Git repository is the knowledge source of truth.
- `kb.yaml` defines domain semantics; the client must not hardcode domain-specific concepts like experiments.
- Permission and review policy is deferred; the MVP exposes safe status/dry-run signals but does not enforce human review.
- All machine-facing commands must support bounded JSON output.
- Mutating commands must support `--dry-run` where meaningful.
- Secret values and long tool outputs must not be persisted verbatim by default.

## 5. MVP Definition

MVP means a local user or agent can use `kb` against a local Git repository without a running backend service.

### In Scope

| Area | Commands / Capability | Acceptance Criteria |
|---|---|---|
| Repo setup | `kb init`, `kb attach`, `kb status` | Creates or attaches a KB with `kb.yaml`; can clone from a Git URL when requested; reports repo state as JSON |
| Config | `kb config get`, `kb config validate` | Validates domain definitions and collaboration settings |
| Structured retrieval | `kb tree`, `kb grep`, `kb read` | Returns bounded JSON over configured domains/roots |
| Domain discovery | `kb domain list`, `kb domain schema` | Agents can discover what record types exist and what fields/templates they require |
| Domain records | `kb domain append`, `kb domain list-records` | Creates/list records using domain config, not hardcoded command names |
| Change dry-run | `kb change create --dry-run` | Shows target branch, files, commit message, and diff summary without writing |
| Change create | `kb change create` | Creates local change branch/commit using collaboration settings; review policy is deferred |
| Audit breadcrumbs | commit trailers / command metadata | Includes agent/user/run metadata when provided |

### Out of Scope for MVP

- Hardcoded `kb experiment ...` or `kb proposal ...` commands.
- MCP server.
- Runtime backend.
- Frontend timeline UI.
- Multiple Git forge adapters.
- PR creation against hosted forge.
- Vector/RAG retrieval.
- Asset storage, dataset registry, model registry.
- Full experiment tracker import from MLflow/W&B/Aim.
- Complex policy engine.

## 6. Configuration Model

Domains are configured in `kb.yaml`:

```yaml
version: 1
repo:
  kind: team-kb
  default_branch: main

domains:
  experiments:
    root: experiments/
    description: Experiment progress and run notes
    path_template: "{project}/{date}-{slug}.md"
    required_fields: [project, title, status]
    optional_fields: [tags, external_assets, next_action]
    frontmatter:
      type: experiment_progress
  seminars:
    root: seminars/
    description: Seminar notes and summaries
    path_template: "{date}-{slug}/summary.md"
    required_fields: [title, date]
    optional_fields: [speaker, tags, source_refs]
    frontmatter:
      type: seminar

collaboration:
  branch_prefix: changes/
  require_human_review: false
```

This means `experiments` is a data/config value, not a CLI capability compiled into the client.

## 7. Key User Stories

### Story 1: Attach Existing Team KB

As a researcher, I can attach an existing repository as `.research-kb` so local tools and agents know where team knowledge lives.

Acceptance:

- `kb attach --path .research-kb --mode ignored-subrepo --repo <url>` records attachment metadata.
- `kb attach --repo <url> --path .research-kb --clone --init-if-missing --json` clones and bootstraps a missing config without committing or pushing.
- `kb status --json` returns repo path, branch, HEAD, dirty state, and config validity.

### Story 2: Agent Discovers Domains

As an agent, I can inspect what kinds of records this team supports before writing anything.

Acceptance:

- `kb domain list --json` returns configured domain names, roots, descriptions, and required fields.
- `kb domain schema experiments --json` returns path template, field rules, and frontmatter defaults.
- Unsupported domains fail with `KB_DOMAIN_NOT_FOUND`.

### Story 3: Agent Reads Bounded Context

As an agent, I can inspect the KB without flooding context.

Acceptance:

- `kb tree --domain experiments --max-depth 3 --json --limit 200` returns bounded paths inside that domain.
- `kb grep "slurm" --domain handbook --context 2 --limit 10 --json` returns snippets with line ranges.
- `kb read handbook/compute/slurm.md --range 1:120 --json` returns only requested lines.

### Story 4: Researcher Appends a Domain Record

As a researcher or agent, I can append a configured domain record with structured metadata.

Acceptance:

- `kb domain append --domain experiments --field project=diffusion-agent --field title="lr sweep batch 3" --field status=running --json` creates a Markdown record under the configured domain root.
- Generated note contains frontmatter from domain config plus provided fields.
- Missing required fields fail with `KB_DOMAIN_FIELD_REQUIRED`.

### Story 5: Agent Prepares Reviewable Change

As an agent, I can submit selected KB changes without knowing whether they came from experiments, seminars, or another domain.

Acceptance:

- `kb change create --paths experiments/diffusion-agent/foo.md --dry-run --json` reports intended branch, files, commit trailers, and diff summary.
- `kb change create --paths ... --json` creates a local branch and commit.
- Review and permission enforcement is deferred to a later policy layer.

## 8. Success Metrics

- A fresh local repo can complete setup/read/domain-record/change workflow in under 10 CLI commands.
- All MVP commands have deterministic JSON golden tests.
- No MVP command prints non-JSON to stdout when `--json` is set.
- Domain record creation works for at least two configured domains without new code paths.
- Change creation has a dry-run path with no filesystem writes except temporary files.

## 9. Architecture Decisions Locked for MVP

| Decision | Rationale | Revisit When |
|---|---|---|
| Domain-driven config | avoids hardcoded lab semantics | domain schema becomes too expressive for YAML |
| Generic `kb domain ...` | one CLI surface for many record types | users need ergonomic aliases generated from config |
| Generic `kb change ...` | separates collaboration primitive from content domains | hosted forge workflow becomes dominant |
| Wrap Git CLI first | fastest reliable MVP; easy to debug | performance or portability becomes a blocker |
| No daemon in MVP | removes lifecycle complexity | repeated repo status calls become too slow |
| No RAG in MVP | CLI retrieval is enough to validate workflow | grep/read workflows fail real agent tasks |

## 10. Main Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Domain schema overdesign | delayed MVP | keep field validation simple: required/optional/defaults/path template |
| CLI output instability | agents become brittle | golden tests for JSON schemas and errors |
| Unsafe Git writes | data loss or default-branch pollution | default-branch guard, dry-run, explicit branch prefix |
| Retrieval too noisy | agent context overload | enforce `--limit`, `--range`, truncation metadata |
| Config too flexible | hard-to-test behavior | versioned schema with validation warnings/errors |

## 11. Implementation Stop Condition

MVP is complete when these commands have docs, JSON schema examples, and tests:

```text
kb init
kb attach
kb status
kb config get
kb config validate
kb tree
kb grep
kb read
kb domain list
kb domain schema
kb domain append
kb domain list-records
kb change create --dry-run
kb change create
```

Runtime, MCP, frontend, and hosted PR creation should not start until this stop condition is met.
