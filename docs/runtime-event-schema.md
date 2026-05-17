# Runtime Event Schema Specification

> Status: Draft 0.1  
> Scope: V1 runtime integration after local `kb` CLI MVP.  
> Parent architecture: `docs/research-agent-collab-architecture.md`

## 1. Purpose

The runtime backend persists agent execution as an append-only event stream. It does not own knowledge content. Knowledge content remains in Git; runtime events explain who/what produced actions, tool calls, artifacts, approvals, and change links.

## 2. Core Entities

### 2.1 Thread

A thread is a long-lived conversation or task context.

```json
{
  "id": "thread_abc",
  "project_id": "proj_123",
  "owner_id": "user_alice",
  "title": "Archive seminar notes",
  "visibility": "private",
  "created_at": "2026-05-16T14:00:00Z",
  "updated_at": "2026-05-16T14:10:00Z"
}
```

### 2.2 Run

A run is one execution attempt by an agent inside a thread.

```json
{
  "id": "run_01HX",
  "thread_id": "thread_abc",
  "parent_run_id": null,
  "agent_id": "built-in-research-agent",
  "user_id": "user_alice",
  "status": "running",
  "model_provider": "openai",
  "model_name": "gpt-x",
  "git_ref": "abc1234",
  "sandbox_id": "sandbox_run_01HX",
  "trace_id": "trace_789",
  "started_at": "2026-05-16T14:01:00Z",
  "ended_at": null
}
```

Run statuses:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> cancelled
queued -> running -> waiting_for_input -> running
queued -> running -> waiting_for_approval -> running
queued -> running -> paused -> running
```

Terminal statuses: `succeeded`, `failed`, `cancelled`.

## 3. Event Envelope

All events use a stable envelope:

```json
{
  "id": "evt_000042",
  "run_id": "run_01HX",
  "thread_id": "thread_abc",
  "seq": 42,
  "type": "TOOL_CALL_STARTED",
  "actor": {
    "type": "agent",
    "id": "built-in-research-agent"
  },
  "payload": {},
  "redaction": {
    "payload_redacted": false,
    "reason": null
  },
  "prev_hash": "hash_041",
  "event_hash": "hash_042",
  "created_at": "2026-05-16T14:02:00Z"
}
```

Rules:

- `seq` is monotonic per run.
- Events are append-only; corrections are represented by later events.
- `payload` must be valid JSON.
- Redacted fields must be replaced with explicit markers, not silently omitted.
- `prev_hash` and `event_hash` are optional in non-audit deployments but schema fields should exist in storage.

## 4. Event Types

### 4.1 Run Lifecycle

#### `RUN_STARTED`

```json
{
  "input_summary": "Create change from seminar notes",
  "workspace": {
    "path": "/workspaces/run_01HX",
    "kb_path": "/workspaces/run_01HX/.research-kb"
  }
}
```

#### `RUN_STATUS_CHANGED`

```json
{
  "from": "running",
  "to": "waiting_for_approval",
  "reason": "kb.change.create requested branch creation"
}
```

#### `RUN_FINISHED`

```json
{
  "status": "succeeded",
  "output_summary": "Created local change branch changes/alice/archive-seminar",
  "knowledge_changes": ["kc_123"],
  "artifacts": ["artifact_456"]
}
```

#### `RUN_ERROR`

```json
{
  "code": "TOOL_EXECUTION_FAILED",
  "message": "kb change create failed",
  "recoverable": true,
  "details_ref": "tool_call_123"
}
```

### 4.2 Text Streaming

#### `TEXT_MESSAGE_START`

```json
{
  "message_id": "msg_001",
  "role": "assistant"
}
```

#### `TEXT_MESSAGE_CONTENT`

```json
{
  "message_id": "msg_001",
  "delta": "I will inspect the KB status first."
}
```

#### `TEXT_MESSAGE_END`

```json
{
  "message_id": "msg_001",
  "content_ref": null,
  "token_usage": {
    "input_tokens": 1200,
    "output_tokens": 80
  }
}
```

### 4.3 Tool Calls

#### `TOOL_CALL_STARTED`

```json
{
  "tool_call_id": "tool_001",
  "tool_name": "kb.grep",
  "transport": "process",
  "args_redacted": {
    "query": "slurm",
    "path": "handbook/",
    "limit": 10
  },
  "approval_id": null,
  "timeout_ms": 30000
}
```

#### `TOOL_CALL_ARGS`

Use only when arguments stream separately or are large.

```json
{
  "tool_call_id": "tool_001",
  "delta": {
    "context": 2
  }
}
```

#### `TOOL_CALL_RESULT`

```json
{
  "tool_call_id": "tool_001",
  "status": "succeeded",
  "exit_code": 0,
  "stdout_ref": "blob://tool_001/stdout.json",
  "stderr_ref": "blob://tool_001/stderr.txt",
  "summary": {
    "results": 4,
    "truncated": false
  }
}
```

Rules:

- Store full stdout/stderr by reference when large.
- Persist a small summary inline.
- Redact secrets before persistence.
- Preserve process exit code.

### 4.4 Artifacts and Knowledge Changes

#### `ARTIFACT_CREATED`

```json
{
  "artifact_id": "artifact_456",
  "kind": "markdown",
  "path": "outputs/seminar-summary.md",
  "sha256": "...",
  "size_bytes": 2048
}
```

#### `KNOWLEDGE_CHANGE_CREATED`

```json
{
  "knowledge_change_id": "kc_123",
  "repo_id": "team-kb",
  "branch": "changes/alice/archive-seminar",
  "commit_sha": "def5678",
  "pr_id": null,
  "diff_summary": {
    "files_changed": 1,
    "insertions": 80,
    "deletions": 0
  },
  "status": "local_change"
}
```

Knowledge change statuses:

```text
planned
local_change
pr_opened
merged
rejected
abandoned
```

### 4.5 Approval

#### `APPROVAL_REQUESTED`

```json
{
  "approval_id": "approval_001",
  "action_type": "kb.change.create",
  "risk_level": "medium",
  "summary": "Create change branch and local commit",
  "requested_by": "built-in-research-agent",
  "expires_at": null
}
```

#### `APPROVAL_DECIDED`

```json
{
  "approval_id": "approval_001",
  "decision": "approved",
  "decided_by": "user_alice",
  "reason": "Proposal branch is expected"
}
```

MVP runtime can use all-allow policy, but event types should exist so policy can become stricter later.

### 4.6 State and Checkpoint

#### `STATE_SNAPSHOT`

```json
{
  "snapshot_id": "snap_001",
  "kind": "agent_state",
  "state_ref": "blob://snap_001/state.json",
  "summary": "After KB retrieval before change creation"
}
```

Rules:

- Snapshots are optional but should be resumable when present.
- State references must not include raw secrets.

## 5. REST and SSE API

### 5.1 REST Endpoints

```http
POST /api/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/events
POST /api/runs/{run_id}/input
POST /api/runs/{run_id}/cancel
POST /api/approvals/{approval_id}/decision
```

### 5.2 SSE Frame

Each SSE message sends one event envelope:

```text
event: TOOL_CALL_STARTED
id: evt_000042
data: {"id":"evt_000042","run_id":"run_01HX","seq":42,"type":"TOOL_CALL_STARTED","payload":{}}
```

Replay rules:

- Clients may resume from the last SSE `id`.
- Server returns events with `seq` greater than the last acknowledged event.
- Duplicate delivery is allowed; clients must de-duplicate by event `id`.

## 6. Database Mapping

### `agent_event`

| Column | Source |
|---|---|
| `id` | event envelope `id` |
| `run_id` | event envelope `run_id` |
| `seq` | event envelope `seq` |
| `event_type` | event envelope `type` |
| `actor_type` | event envelope `actor.type` |
| `payload_json` | event envelope `payload` |
| `payload_redacted` | event envelope `redaction.payload_redacted` |
| `prev_hash` | event envelope `prev_hash` |
| `event_hash` | event envelope `event_hash` |
| `created_at` | event envelope `created_at` |

### `tool_call`

Created on `TOOL_CALL_STARTED`, finalized on `TOOL_CALL_RESULT`.

### `knowledge_change`

Created on `KNOWLEDGE_CHANGE_CREATED`, updated by later PR/merge/reject events.

### `approval`

Created on `APPROVAL_REQUESTED`, finalized on `APPROVAL_DECIDED`.

## 7. Redaction Rules

Must redact before persistence:

- API keys and bearer tokens.
- SSH private keys.
- Passwords and session cookies.
- Full environment variable dumps.
- Large stdout/stderr beyond configured inline limits.

Recommended inline limits:

| Field | Limit |
|---|---:|
| text delta | 8 KiB |
| tool args | 16 KiB |
| tool result summary | 16 KiB |
| full stdout/stderr inline | 0 bytes; store by reference |

## 8. Runtime Integration with `kb`

When runtime invokes `kb`, it should set:

```text
KB_AGENT_RUN_ID=<run_id>
KB_SESSION_ID=<thread_id>
KB_GENERATED_BY=built-in-runtime
```

The runtime should capture:

- Process command name and normalized args.
- Exit code.
- JSON result summary.
- stderr summary.
- Created artifacts and change branch/commit when present.

The runtime should not parse human output. Runtime calls must use `--json`.

## 9. Completion Criteria for Runtime V1

Runtime V1 is complete only when:

- Run status transitions are persisted and replayable.
- Tool calls to `kb status`, `kb grep`, and `kb change create --dry-run` are recorded end-to-end.
- SSE clients can disconnect and resume without losing event order.
- Failed tool calls produce `RUN_ERROR` or recoverable status events.
- Redaction tests prove known secret patterns are not persisted inline.
