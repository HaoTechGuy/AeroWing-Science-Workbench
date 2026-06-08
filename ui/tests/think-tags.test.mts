import assert from "node:assert/strict";
import test from "node:test";

import {
  extractStringFromMessageContent,
  extractVisibleStringFromMessageContent,
  stripThinkTagsForDisplay,
} from "../src/app/utils/utils.ts";

test("stripThinkTagsForDisplay removes closed think blocks", () => {
  assert.equal(
    stripThinkTagsForDisplay('<think>secret</think>\n\n你好'),
    "你好"
  );
  assert.equal(
    stripThinkTagsForDisplay(
      'a<think>one</think>b<THINK data-source="x">two</Think>c'
    ),
    "abc"
  );
});

test("stripThinkTagsForDisplay handles incomplete and non-think tags", () => {
  assert.equal(stripThinkTagsForDisplay("<think>streaming"), "");
  assert.equal(stripThinkTagsForDisplay("before <think>streaming"), "before ");
  assert.equal(
    stripThinkTagsForDisplay("keep <thinker>visible</thinker> text"),
    "keep <thinker>visible</thinker> text"
  );
});

test("visible extraction only hides think blocks for AI messages", () => {
  const humanMessage = {
    id: "human-1",
    type: "human",
    content: "<think>keep me</think>\n\nhi",
  } as any;
  const toolMessage = {
    id: "tool-1",
    type: "tool",
    content: "<think>keep me</think>\n\nresult",
  } as any;

  assert.equal(
    extractVisibleStringFromMessageContent(humanMessage),
    "<think>keep me</think>\n\nhi"
  );
  assert.equal(
    extractVisibleStringFromMessageContent(toolMessage),
    "<think>keep me</think>\n\nresult"
  );
});

test("visible AI list content is sanitized without mutating the raw message", () => {
  const content = [
    { type: "text", text: "<think>secret</think>\n\n你好" },
    { type: "image_url", image_url: "https://example.invalid/image.png" },
    " world",
  ];
  const message = {
    id: "ai-1",
    type: "ai",
    content,
    additional_kwargs: {
      reasoning_content: "secret",
    },
  } as any;
  const before = JSON.stringify(message);

  assert.equal(
    extractStringFromMessageContent(message),
    "<think>secret</think>\n\n你好 world"
  );
  assert.equal(extractVisibleStringFromMessageContent(message), "你好 world");
  assert.equal(JSON.stringify(message), before);
  assert.equal(message.additional_kwargs.reasoning_content, "secret");
});

test("visible AI extraction preserves non-think text that looks like attachments", () => {
  const message = {
    id: "ai-2",
    type: "ai",
    content: [{ type: "text", text: "<attachment demo>\nvisible" }],
  } as any;

  assert.equal(
    extractVisibleStringFromMessageContent(message),
    "<attachment demo>\nvisible"
  );
});
