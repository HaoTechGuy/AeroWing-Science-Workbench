import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeValuesWithMessages,
  resolveThreadListValues,
} from "../src/lib/thread-state.ts";
import { loadPendingRunInputPreview } from "../src/lib/pending-run-input.ts";

const rootValues = {
  messages: [
    {
      id: "root-human",
      type: "human",
      content: "理解一下，然后把参考文献提取出来。",
    },
  ],
  todos: [{ content: "root todo", status: "pending" }],
};

const subtaskValues = {
  messages: [
    {
      id: "subtask-human",
      type: "human",
      content: 'Search for the paper "Trust within human-machine..."',
    },
    {
      id: "subtask-ai",
      type: "ai",
      content: "Here are the complete findings...",
    },
  ],
  files: { "paper.md": "summary" },
};

test("mergeValuesWithMessages preserves canonical root messages when requested", () => {
  const merged = mergeValuesWithMessages(rootValues, subtaskValues, {
    preservePrimaryMessages: true,
  });

  assert.deepEqual(merged.messages, rootValues.messages);
  assert.deepEqual(merged.files, subtaskValues.files);
});

test("mergeValuesWithMessages still uses incoming messages without preservation", () => {
  const merged = mergeValuesWithMessages(rootValues, subtaskValues);

  assert.deepEqual(merged.messages, subtaskValues.messages);
});

test("resolveThreadListValues prefers main state over polluted thread values", async () => {
  const result = await resolveThreadListValues({
    threadValues: subtaskValues,
    loadMainStateValues: async () => rootValues,
    loadRuntimeStateValues: async () => subtaskValues,
  });

  assert.equal(result, rootValues);
});

test("resolveThreadListValues falls back to thread values when main state has no messages", async () => {
  const result = await resolveThreadListValues({
    threadValues: subtaskValues,
    loadMainStateValues: async () => ({ messages: [] }),
    loadRuntimeStateValues: async () => rootValues,
  });

  assert.equal(result, subtaskValues);
});

test("resolveThreadListValues prefers run input preview before polluted thread values", async () => {
  const result = await resolveThreadListValues({
    threadValues: subtaskValues,
    loadMainStateValues: async () => ({ messages: [] }),
    loadPendingValues: async () => rootValues,
    loadRuntimeStateValues: async () => subtaskValues,
  });

  assert.equal(result, rootValues);
});

test("loadPendingRunInputPreview can recover input from errored runs", async () => {
  const client = {
    runs: {
      list: async () => [
        {
          run_id: "run-1",
          status: "error",
          kwargs: {
            input: {
              messages: rootValues.messages,
            },
          },
          metadata: { resource_id: "local" },
        },
      ],
    },
  } as any;

  const preview = await loadPendingRunInputPreview(client, "thread-1");

  assert.equal(preview?.runId, "run-1");
  assert.deepEqual(preview?.messages, rootValues.messages);
});
