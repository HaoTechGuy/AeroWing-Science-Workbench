---
name: local-release-test
description: Use the repository-local GitHub Actions release workflow to publish prerelease test builds from development branches without touching the official shuyuehu/InternAgents release repository.
---

# Local Release Test

Use this skill when a developer asks to create, run, monitor, or explain the repository-local release testing workflow for InternAgents desktop builds.

The goal is to let different developers publish test releases from different branches in `qzzqzzb/InternAgents` without overwriting official releases or each other's test builds.

## Release Model

- Official releases are still triggered by pushing tags like `v0.1.5`.
- Official releases publish to `shuyuehu/InternAgents` and require `secrets.INTERNAGENTS_RELEASE_TOKEN`.
- Local test releases are triggered manually with `workflow_dispatch`.
- Local test releases publish to the current repository, normally `qzzqzzb/InternAgents`.
- Local test releases use the built-in `GITHUB_TOKEN`.
- Local test releases are marked as GitHub prereleases, so they do not replace the repository's latest stable release.

The workflow generates test tags automatically:

```text
v<base_version>-test.<safe_branch_name>.<utc_timestamp>
```

Example:

```text
v0.1.5-test.zhf-local-release-for-test.20260603.192500
```

The timestamp is UTC in `yyyyMMdd.HHmmss` format. Branch separators and unsafe characters are normalized to hyphens.

GitHub Actions run names are separate from release tags. The run name includes the branch, base version, and run number for quick scanning, while the final GitHub Release tag and title include the branch timestamp.

## Before Running

1. Confirm the developer branch has been pushed to GitHub.
2. Confirm `.github/workflows/release.yml` on the default branch includes `workflow_dispatch`. If this workflow support is still only in a PR branch, merge that support first before relying on manual dispatch.
3. Confirm the branch includes the code that should be packaged.
4. Choose a `base_version`, usually the next version being tested, such as `0.1.5`.

## Trigger From GitHub UI

1. Open `qzzqzzb/InternAgents` on GitHub.
2. Go to `Actions`.
3. Select the `Release` workflow.
4. Click `Run workflow`.
5. Select the development branch to package.
6. Set `base_version`.
7. Optionally set `release_notes`.
8. Start the workflow.

## Trigger With GitHub CLI

Use `gh` when it is available and authenticated:

```powershell
gh workflow run release.yml `
  --repo qzzqzzb/InternAgents `
  --ref <branch-name> `
  -f base_version=0.1.5 `
  -f release_notes="Testing <short summary>"
```

Then monitor the run:

```powershell
gh run list --repo qzzqzzb/InternAgents --workflow release.yml --limit 5
gh run watch --repo qzzqzzb/InternAgents <run-id>
```

If `gh` is not installed, use the GitHub connector or GitHub web UI to inspect workflow runs.

## Expected Artifacts

The workflow should publish a prerelease in `qzzqzzb/InternAgents` with:

- macOS Apple Silicon DMG
- macOS Intel DMG
- Windows x64 NSIS installer
- Windows x64 ZIP

The release notes include:

- generated test release tag
- desktop version used for packaging
- source branch and commit
- exact `INTERNAGENTS_UPDATE_API_URL` for testing app updates against that prerelease

## Testing App Updates Against A Test Release

Because local test releases are prereleases, clients should use the exact release API URL from the release notes rather than relying on `/releases/latest`.

Set this in `.env` when testing update checks locally:

```text
INTERNAGENTS_UPDATE_API_URL=https://api.github.com/repos/qzzqzzb/InternAgents/releases/tags/<generated-test-tag>
```

For example:

```text
INTERNAGENTS_UPDATE_API_URL=https://api.github.com/repos/qzzqzzb/InternAgents/releases/tags/v0.1.5-test.zhf-local-release-for-test.20260603.192500
```

Restart the app/backend after changing `.env` so the update endpoint reads the new value.

## Safety Rules

- Do not push or overwrite official `v*.*.*` tags for test-only builds.
- Do not change `INTERNAGENTS_OFFICIAL_RELEASE_REPO` when testing local releases.
- Do not use `INTERNAGENTS_RELEASE_TOKEN` for local test releases.
- Keep local test releases as prereleases unless the developer explicitly asks for a stable release flow change.
- Prefer creating a fresh test release per run; branch-and-timestamp tags are designed to make that cheap and collision-free.

## Troubleshooting

- If the workflow is not shown in the GitHub UI, check that the workflow file with `workflow_dispatch` has been merged to the default branch.
- If the run fails before build jobs start, inspect the `Prepare release metadata` job first.
- If release publishing fails with permission errors during a test release, check the workflow has `contents: write` permission for the `release` job and that repository Actions permissions allow `GITHUB_TOKEN` writes.
- If the app does not see a test release, use `INTERNAGENTS_UPDATE_API_URL` with the exact generated tag URL.
- If an official tag run tries to publish to the development repository, stop and inspect metadata outputs before rerunning.
