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
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function safeProjectsHref(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://internagents.local");
    if (
      parsed.origin !== "http://internagents.local" ||
      parsed.pathname !== "/projects"
    ) {
      return null;
    }

    const next = new URLSearchParams();
    const nestedWorkbenchHref = safeWorkbenchHref(
      parsed.searchParams.get("returnTo")
    );
    if (nestedWorkbenchHref) {
      next.set("returnTo", nestedWorkbenchHref);
    }

    const query = next.toString();
    return `/projects${query ? `?${query}` : ""}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function safeAppReturnHref(value: string | null): string | null {
  return safeProjectsHref(value) || safeWorkbenchHref(value);
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

export function projectsHrefFromSearchParams(searchParams: SearchParamsLike) {
  const explicitReturnTo = safeWorkbenchHref(searchParams.get("returnTo"));
  if (!explicitReturnTo) {
    return "/projects";
  }

  const next = new URLSearchParams();
  next.set("returnTo", explicitReturnTo);
  return `/projects?${next.toString()}`;
}

export function appReturnHrefFromSearchParams(
  searchParams: SearchParamsLike
) {
  return (
    safeAppReturnHref(searchParams.get("returnTo")) ||
    workbenchHrefFromSearchParams(searchParams)
  );
}

export function pageHrefWithWorkbenchReturn(
  pathname: string,
  searchParams: SearchParamsLike
) {
  const next = new URLSearchParams();
  next.set("returnTo", workbenchHrefFromSearchParams(searchParams));
  return `${pathname}?${next.toString()}`;
}

export function pageHrefWithAppReturn(pathname: string, returnHref: string) {
  const safeReturnHref = safeAppReturnHref(returnHref);
  const next = new URLSearchParams();
  if (safeReturnHref) {
    next.set("returnTo", safeReturnHref);
  }
  const query = next.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
