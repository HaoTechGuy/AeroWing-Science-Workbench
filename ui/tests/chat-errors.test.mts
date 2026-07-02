import assert from "node:assert/strict";
import test from "node:test";

import { formatChatError } from "../src/lib/chat-errors.ts";

test("formatChatError explains DeepSeek text-only image_url errors", () => {
  const message =
    "Error code: 400 - {'error': {'message': 'Failed to deserialize the " +
    "JSON body into the target type: messages[104]: unknown variant " +
    "`image_url`, expected `text` at line 1 column 114042'}}";

  assert.match(formatChatError(message) ?? "", /当前模型端点不支持图片输入/);
  assert.match(formatChatError(message) ?? "", /只接受 text/);
});

test("formatChatError explains wrapped RemoteException image errors", () => {
  const message =
    'RemoteException: {"message":"Failed to deserialize the JSON body into ' +
    "the target type: messages[104]: unknown variant `image_url`, expected " +
    '`text` at line 1 column 114042"}';

  assert.match(formatChatError(message) ?? "", /当前模型端点不支持图片输入/);
});
