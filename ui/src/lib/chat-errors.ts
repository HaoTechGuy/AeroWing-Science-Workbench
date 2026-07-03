const IMAGE_INPUT_UNSUPPORTED_CHAT_MESSAGE =
  "当前模型端点不支持图片输入：模型服务拒绝了 image_url 内容块（只接受 text）。系统会移除图片内容并仅基于文本继续；如需图片理解，请切换支持视觉输入的模型。";

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

function specificProviderErrorMessage(message: string): string | null {
  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const lowered = normalized.toLowerCase();

  if (normalized.includes("当前模型端点不支持图片输入")) {
    return normalized;
  }

  const mentionsImageUrl = lowered.includes("image_url");
  const textOnlyVariant =
    /unknown variant\s+`?image_url`?/i.test(normalized) &&
    /expected\s+`?text`?/i.test(normalized);
  const explicitImageUnsupported =
    /no endpoints found that support image input/i.test(normalized) ||
    /does not support image input/i.test(normalized) ||
    /unsupported image input/i.test(normalized);

  if ((mentionsImageUrl && textOnlyVariant) || explicitImageUnsupported) {
    return IMAGE_INPUT_UNSUPPORTED_CHAT_MESSAGE;
  }

  return null;
}

export function formatChatError(error: unknown): string | null {
  if (!error) {
    return null;
  }

  const message = normalizeErrorMessage(error);
  const specificMessage = specificProviderErrorMessage(message);
  if (specificMessage) {
    return specificMessage;
  }

  if (isMalformedRemoteRuntimeError(message)) {
    return (
      "远程 Agent runtime 已返回错误，但当前 LangGraph SDK 无法解析该错误响应，" +
      "请查看 backend 和 runtime 日志获取真实失败原因。"
    );
  }

  const remoteRuntimeMessage = extractRemoteRuntimeErrorMessage(message);
  if (remoteRuntimeMessage) {
    return `远程 Agent runtime 执行失败：${remoteRuntimeMessage}`;
  }

  if (/ConnectError|connection|connect/i.test(message)) {
    return "模型服务连接失败，请检查网络或代理后重试。";
  }

  if (/RemoteException/i.test(message)) {
    return "远程 Agent runtime 执行失败，请查看 backend 和 runtime 日志。";
  }

  return message || "运行失败，请重试。";
}

export function isMalformedRemoteRuntimeError(message: string): boolean {
  return (
    /Response validation failed/i.test(message) &&
    /body\.error\.code/i.test(message)
  );
}

export function extractRemoteRuntimeErrorMessage(message: string): string | null {
  if (!/RemoteException/i.test(message)) {
    return null;
  }

  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const extracted =
    normalized.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ??
    null;

  const normalizedExtracted = extracted?.replace(
    /^远程 Agent runtime 执行失败[:：]\s*/,
    ""
  );
  const candidate = normalizedExtracted ?? normalized;

  const specificMessage = specificProviderErrorMessage(candidate);
  if (specificMessage) {
    return specificMessage;
  }

  if (isMalformedRemoteRuntimeError(candidate)) {
    return (
      "远端 runtime 已返回错误，但当前 LangGraph SDK 无法解析该错误响应，" +
      "请查看 backend 和 runtime 日志获取真实失败原因。"
    );
  }

  if (/Insufficient credits/i.test(candidate)) {
    return "模型服务额度不足，请处理额度后重试。";
  }

  if (/User not found|Unauthorized|401/i.test(candidate)) {
    return "模型服务 API Key 无效或未授权，请在配置页更新 API Key。";
  }

  return normalizedExtracted ?? null;
}
