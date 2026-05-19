"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceEntry, WorkspaceListResponse } from "@/app/types/workspace";

type DirectoryEntries = Record<string, WorkspaceEntry[]>;

async function fetchDirectory(path: string): Promise<WorkspaceListResponse> {
  const response = await fetch(
    `/api/workspace/files?path=${encodeURIComponent(path)}`
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "工作区文件加载失败。");
  }

  return response.json();
}

export function useWorkspaceFiles() {
  const [directories, setDirectories] = useState<DirectoryEntries>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([""])
  );
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [error, setError] = useState<string | null>(null);

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
        const payload = await fetchDirectory(path);
        setDirectories((current) => ({
          ...current,
          [payload.path]: payload.entries,
        }));
        return payload.entries;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "工作区文件加载失败。"
        );
        return [];
      } finally {
        setPathLoading(path, false);
      }
    },
    [directories, setPathLoading]
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

  const refresh = useCallback(async () => {
    setDirectories({});
    setExpandedPaths(new Set([""]));
    await loadDirectory("", true);
  }, [loadDirectory]);

  useEffect(() => {
    loadDirectory("");
    // Load the root directory once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
