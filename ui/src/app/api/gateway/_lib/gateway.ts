const DEFAULT_GATEWAY_URL = "http://43.106.18.167/jisi";

export function normalizeGatewayUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return DEFAULT_GATEWAY_URL;
  }
  const parsed = new URL(raw);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function fixedGatewayUrl() {
  return DEFAULT_GATEWAY_URL;
}

export function gatewayApiBaseUrl(gatewayUrl = fixedGatewayUrl()) {
  const trimmed = gatewayUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function gatewayBootstrapUrl(gatewayUrl = fixedGatewayUrl()) {
  const trimmed = gatewayUrl.replace(/\/+$/, "");
  const origin = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
  return `${origin.replace(/\/+$/, "")}/api/bootstrap-key`;
}

export function gatewayModelsUrl(gatewayUrl = fixedGatewayUrl()) {
  const trimmed = gatewayUrl.replace(/\/+$/, "");
  const origin = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
  return `${origin.replace(/\/+$/, "")}/api/models`;
}
