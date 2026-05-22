"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceEntry,
  WorkspaceListResponse,
} from "@/app/types/workspace";

type DirectoryEntries = Record<string, WorkspaceEntry[]>;

async function fetchDirectory(
  path: string,
  resourceId?: string,
  workspaceId?: string
): Promise<WorkspaceListResponse> {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/workspace/files?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "工作区文件加载失败。");
  }

  return response.json();
}

export function useWorkspaceFiles(
  resourceId?: string,
  workspaceId?: string,
  refreshKey?: number
) {
  const [directories, setDirectories] = useState<DirectoryEntries>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([""])
  );
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const lastHandledRefreshKey = useRef<number | undefined>(refreshKey);

  const setPathLoading = useCallback((path: string, isLoading: boolean) => {
    setLoadingPaths((current) => {
      const next = new Set(current);
      if (isLoading) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const loadDirectory = useCallback(
    async (path: string, force = false) => {
      if (!force && directories[path]) {
        return directories[path];
      }

      setPathLoading(path, true);
      setError(null);

      try {
        const payload = await fetchDirectory(path, resourceId, workspaceId);
        setDirectories((current) => ({
          ...current,
          [payload.path]: payload.entries,
        }));
        return payload.entries;
      } catch (err) {
        setError(err instanceof Error ? err.message : "工作区文件加载失败。");
        return [];
      } finally {
        setPathLoading(path, false);
      }
    },
    [directories, resourceId, setPathLoading, workspaceId]
  );

  const toggleDirectory = useCallback(
    async (path: string) => {
      const isExpanded = expandedPaths.has(path);
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (isExpanded) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });

      if (!isExpanded) {
        await loadDirectory(path);
      }
    },
    [expandedPaths, loadDirectory]
  );

  const reloadDirectories = useCallback(
    async (paths?: string[]) => {
      const targetPaths = paths?.length ? paths : Array.from(expandedPaths);
      const uniquePaths = Array.from(
        new Set(targetPaths.length ? targetPaths : [""])
      );

      setError(null);
      uniquePaths.forEach((path) => setPathLoading(path, true));

      try {
        const payloads = await Promise.all(
          uniquePaths.map((path) =>
            fetchDirectory(path, resourceId, workspaceId)
          )
        );

        setDirectories((current) => {
          const next = { ...current };
          for (const payload of payloads) {
            next[payload.path] = payload.entries;
          }
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "工作区文件加载失败。");
      } finally {
        uniquePaths.forEach((path) => setPathLoading(path, false));
      }
    },
    [expandedPaths, resourceId, setPathLoading, workspaceId]
  );

  const refresh = useCallback(async () => {
    setDirectories({});
    setExpandedPaths(new Set([""]));
    await reloadDirectories([""]);
  }, [reloadDirectories]);

  useEffect(() => {
    let isCancelled = false;

    setDirectories({});
    setExpandedPaths(new Set([""]));
    setPathLoading("", true);
    setError(null);

    fetchDirectory("", resourceId, workspaceId)
      .then((payload) => {
        if (!isCancelled) {
          setDirectories({ [payload.path]: payload.entries });
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "工作区文件加载失败。");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setPathLoading("", false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [resourceId, setPathLoading, workspaceId]);

  useEffect(() => {
    if (refreshKey === undefined) {
      return;
    }

    if (lastHandledRefreshKey.current === refreshKey) {
      return;
    }

    lastHandledRefreshKey.current = refreshKey;
    void reloadDirectories();
  }, [refreshKey, reloadDirectories]);

  return useMemo(
    () => ({
      directories,
      expandedPaths,
      loadingPaths,
      error,
      loadDirectory,
      toggleDirectory,
      refresh,
    }),
    [
      directories,
      error,
      expandedPaths,
      loadDirectory,
      loadingPaths,
      refresh,
      toggleDirectory,
    ]
  );
}
