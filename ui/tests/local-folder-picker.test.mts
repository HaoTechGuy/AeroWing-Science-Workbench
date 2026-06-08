import assert from "node:assert/strict";
import test from "node:test";

import { decodeWindowsFolderPickerOutput } from "../src/app/api/_lib/local-folder-picker.ts";

test("decodeWindowsFolderPickerOutput preserves UTF-8 folder paths", () => {
  const selectedPath = "C:\\Users\\测试\\项目 中文";
  const stdout = `${Buffer.from(selectedPath, "utf8").toString("base64")}\r\n`;

  assert.equal(decodeWindowsFolderPickerOutput(stdout), selectedPath);
});

test("decodeWindowsFolderPickerOutput treats empty output as cancellation", () => {
  assert.equal(decodeWindowsFolderPickerOutput("\r\n"), "");
});
