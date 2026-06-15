type SearchParamsLike = {
  get(name: string): string | null;
};

export const WORKBENCH_RETURN_STORAGE_KEY = "internagents.lastWorkbenchHref";

const WORKBENCH_QUERY_KEYS = [
  "assistantId",
  "resourceId",
  "workspaceId",
  "threadId",
  "file",
] as const;
const ONE_SHOT_WORKBENCH_QUERY_KEYS = ["quickstart"] as const;

export function safeWorkbenchHref(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://internagents.local");
    if (
      parsed.origin !== "http://internagents.local" ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    for (const key of ONE_SHOT_WORKBENCH_QUERY_KEYS) {
      parsed.searchParams.delete(key);
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function workbenchHrefFromSearchParams(searchParams: SearchParamsLike) {
  const explicitReturnTo = safeWorkbenchHref(searchParams.get("returnTo"));
  if (explicitReturnTo) {
    return explicitReturnTo;
  }

  const next = new URLSearchParams();
  for (const key of WORKBENCH_QUERY_KEYS) {
    const value = searchParams.get(key);
    if (value) {
      next.set(key, value);
    }
  }

  if (!next.has("assistantId")) {
    next.set("assistantId", "agent_local");
  }

  return `/?${next.toString()}`;
}

export function pageHrefWithWorkbenchReturn(
  pathname: string,
  searchParams: SearchParamsLike
) {
  const next = new URLSearchParams();
  next.set("returnTo", workbenchHrefFromSearchParams(searchParams));
  return `${pathname}?${next.toString()}`;
}
