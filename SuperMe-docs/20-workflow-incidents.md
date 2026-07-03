# Workflow Incidents

## 2026-07-02 - Unverified Claude Science Remote Job Entry Point

- Incident: Codex stated that Claude Science remote job submission happened from Settings > Compute.
- Correction: Official docs say Settings > Compute > SSH hosts is for adding/probing hosts. Remote job submission is proposed in the conversation and approved through a `Run this job on <host>?` permission card.
- Follow-up: Keep Settings UI limited to host configuration/status. Implement conversation-level remote job permission cards separately.
