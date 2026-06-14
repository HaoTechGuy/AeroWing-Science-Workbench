import assert from "node:assert/strict";
import test from "node:test";

import { shouldForwardEventToUseStream } from "../src/lib/remote-agent.ts";

test("shouldForwardEventToUseStream forwards root graph events", () => {
  assert.equal(shouldForwardEventToUseStream("values"), true);
  assert.equal(shouldForwardEventToUseStream("updates"), true);
  assert.equal(shouldForwardEventToUseStream("messages-tuple"), true);
});

test("shouldForwardEventToUseStream blocks all namespaced subgraph events", () => {
  assert.equal(
    shouldForwardEventToUseStream("messages-tuple|remote_runtime:fdfa6aa4"),
    false
  );
  assert.equal(
    shouldForwardEventToUseStream("updates|remote_runtime:fdfa6aa4"),
    false
  );
  assert.equal(
    shouldForwardEventToUseStream("values|remote_runtime:fdfa6aa4"),
    false
  );
});
