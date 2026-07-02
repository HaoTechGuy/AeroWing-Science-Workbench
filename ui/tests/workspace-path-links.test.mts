import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkspacePreviewPath,
  splitTextByWorkspacePaths,
} from "../src/app/utils/workspacePathLinks.ts";

const WORKSPACE_ROOT = "/Users/qszhang/Documents/openclaudescience";

test("normalizes absolute workspace paths to preview paths", () => {
  assert.equal(
    normalizeWorkspacePreviewPath(
      "/Users/qszhang/Documents/openclaudescience/ui/src/app/page.tsx:274",
      { workspaceRoot: WORKSPACE_ROOT }
    )?.previewPath,
    "ui/src/app/page.tsx"
  );

  assert.equal(
    normalizeWorkspacePreviewPath(
      "file:///Users/qszhang/Documents/openclaudescience/caffeine_study/caffeine_LUMO%2B2.cube",
      { workspaceRoot: WORKSPACE_ROOT }
    )?.previewPath,
    "caffeine_study/caffeine_LUMO+2.cube"
  );
});

test("normalizes workspace-relative and logical absolute paths", () => {
  assert.equal(
    normalizeWorkspacePreviewPath("ui/src/app/components/MarkdownContent.tsx", {
      workspaceRoot: WORKSPACE_ROOT,
    })?.previewPath,
    "ui/src/app/components/MarkdownContent.tsx"
  );

  assert.equal(
    normalizeWorkspacePreviewPath("/.internagents/uploads/report.pdf", {
      workspaceRoot: WORKSPACE_ROOT,
    })?.previewPath,
    ".internagents/uploads/report.pdf"
  );
});

test("rejects absolute local files outside the active workspace", () => {
  assert.equal(
    normalizeWorkspacePreviewPath("/tmp/outside.md", {
      workspaceRoot: WORKSPACE_ROOT,
    }),
    null
  );
});

test("splits plain text around workspace file paths", () => {
  const parts = splitTextByWorkspacePaths(
    "已更新 ui/src/app/page.tsx:274 和 caffeine_study/caffeine_LUMO+2.cube。",
    { workspaceRoot: WORKSPACE_ROOT }
  );

  const targets = parts
    .filter((part) => typeof part !== "string")
    .map((part) => part.target.previewPath);

  assert.deepEqual(targets, [
    "ui/src/app/page.tsx",
    "caffeine_study/caffeine_LUMO+2.cube",
  ]);
});

test("allows bare file names only when explicitly requested", () => {
  assert.equal(
    normalizeWorkspacePreviewPath("AGENTS.md", {
      workspaceRoot: WORKSPACE_ROOT,
    }),
    null
  );

  assert.equal(
    normalizeWorkspacePreviewPath("AGENTS.md", {
      workspaceRoot: WORKSPACE_ROOT,
      allowBareFile: true,
    })?.previewPath,
    "AGENTS.md"
  );
});
