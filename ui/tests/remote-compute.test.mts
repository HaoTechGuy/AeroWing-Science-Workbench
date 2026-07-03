import assert from "node:assert/strict";
import test from "node:test";

import { assertSshCommand } from "../src/lib/ssh-command.ts";

test("assertSshCommand accepts host-only ssh command", () => {
  assert.equal(assertSshCommand("ssh rd"), "ssh rd");
  assert.equal(
    assertSshCommand("ssh -p 2222 user@example.com"),
    "ssh -p 2222 user@example.com"
  );
});

test("assertSshCommand rejects embedded remote command", () => {
  assert.throws(() => assertSshCommand("ssh rd uname -a"), /remote command/);
});

test("assertSshCommand rejects non-ssh command", () => {
  assert.throws(() => assertSshCommand("bash -lc pwd"), /must start with ssh/);
});
