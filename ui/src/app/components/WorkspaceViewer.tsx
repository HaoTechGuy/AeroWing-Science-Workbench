"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Database,
  ExternalLink,
  Loader2,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { MoleculeViewer } from "@/app/components/MoleculeViewer";
import { ScienceSceneViewer } from "@/app/components/ScienceSceneViewer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  WorkspaceFileResponse,
  WorkspaceOfficePreviewBlock,
} from "@/app/types/workspace";
import { useLanguage } from "@/app/hooks/useLanguage";

interface WorkspaceViewerProps {
  selectedPath?: string | null;
  resourceId?: string;
  workspaceId?: string;
  compact?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onClear?: () => void;
  onResolvedPath?: (path: string) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".css": "css",
  caddyfile: "text",
  dockerfile: "dockerfile",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  gemfile: "ruby",
  makefile: "makefile",
  procfile: "text",
  ".py": "python",
  rakefile: "ruby",
  ".sh": "bash",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const PREVIEW_KIND_LABELS: Record<WorkspaceFileResponse["previewKind"], string> =
  {
    binary: "Binary",
    cae: "CAE",
    docx: "Docx",
    image: "Image",
    markdown: "Markdown",
    molecule: "Molecule",
    pdf: "PDF",
    pptx: "PPT",
    science: "Science",
    text: "Text",
    unsupported: "File",
    xlsx: "Excel",
  };

function previewKindLabel(kind: WorkspaceFileResponse["previewKind"]): string {
  return PREVIEW_KIND_LABELS[kind] || kind;
}

function isOfficePreviewKind(
  kind: WorkspaceFileResponse["previewKind"] | undefined
) {
  return kind === "docx" || kind === "xlsx" || kind === "pptx";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchWorkspaceFile(
  path: string,
  resourceId?: string,
  workspaceId?: string
): Promise<WorkspaceFileResponse> {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/workspace/file?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to load file.");
  }

  return response.json();
}

interface CaeSummaryResponse {
  summary: {
    metadata?: Record<string, unknown>;
    geometry?: Record<string, unknown>;
    mesh?: Record<string, unknown>;
    materials?: Record<string, unknown>;
    loads?: Record<string, unknown>;
    results?: Record<string, unknown>;
    checks?: Array<{ severity?: string; message?: string }>;
  };
}

interface CaeMeshPayload {
  metadata?: Record<string, unknown>;
  vertices?: number[][];
  faces?: number[][];
  lines?: number[][];
  element_types?: Record<string, number>;
  checks?: Array<{ severity?: string; message?: string }>;
}

interface CaeMeshResponse {
  cacheHit?: boolean;
  mesh: CaeMeshPayload;
}

async function fetchCaeSummary(
  path: string,
  resourceId?: string,
  workspaceId?: string
): Promise<CaeSummaryResponse> {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/workspace/cae-summary?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to generate CAE summary.");
  }

  return response.json();
}

async function fetchCaeMesh(
  path: string,
  resourceId?: string,
  workspaceId?: string
): Promise<CaeMeshResponse> {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/workspace/cae-mesh?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to generate CAE mesh.");
  }

  return response.json();
}

function EmptyViewer() {
  const { t } = useLanguage();
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]">
          <PanelRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("emptyPreview")}
        </p>
      </div>
    </div>
  );
}

function CollapsePreviewButton({ onCollapse }: { onCollapse?: () => void }) {
  const { t } = useLanguage();
  if (!onCollapse) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={t("collapseFilePreview")}
          onClick={onCollapse}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="whitespace-nowrap"
      >
        {t("collapseFilePreview")}
      </TooltipContent>
    </Tooltip>
  );
}

function ClearPreviewButton({ onClear }: { onClear?: () => void }) {
  const { t } = useLanguage();
  if (!onClear) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={t("closeFilePreview")}
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="whitespace-nowrap"
      >
        {t("closeFilePreview")}
      </TooltipContent>
    </Tooltip>
  );
}

function ViewerHeader({
  title,
  onCollapse,
}: {
  title: string;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold leading-5">{title}</h2>
      </div>
      <CollapsePreviewButton onCollapse={onCollapse} />
    </div>
  );
}

function hasOfficeBlockContent(block: WorkspaceOfficePreviewBlock): boolean {
  return Boolean(block.lines?.length || block.rows?.length);
}

function OfficeFallback({ message }: { message?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-sm rounded-md border border-border bg-muted p-5 text-sm leading-6 text-muted-foreground">
        {message || t("noPreviewAvailable")}
      </div>
    </div>
  );
}

function OfficeTextBlock({
  block,
  documentMode = false,
}: {
  block: WorkspaceOfficePreviewBlock;
  documentMode?: boolean;
}) {
  const { t } = useLanguage();
  const lines = block.lines || [];
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noPreviewText")}</p>;
  }

  return (
    <div className={documentMode ? "space-y-4" : "space-y-3"}>
      {lines.map((line, index) => (
        <p
          key={`${index}-${line.slice(0, 24)}`}
          className={
            documentMode
              ? "whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground"
              : "whitespace-pre-wrap break-words text-sm leading-6 text-foreground"
          }
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function OfficeSheetBlock({ block }: { block: WorkspaceOfficePreviewBlock }) {
  const { t } = useLanguage();
  const rows = block.rows || [];
  const maxColumns = Math.max(...rows.map((row) => row.length), 0);
  const columns = Array.from({ length: maxColumns }, (_, index) => index);

  if (rows.length === 0 || maxColumns === 0) {
    return <p className="text-sm text-muted-foreground">{t("noPreviewSheet")}</p>;
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background">
      <div className="scrollbar-subtle w-full min-w-0 overflow-x-auto overflow-y-hidden pb-2">
        <table className="w-max min-w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-border last:border-b-0"
              >
                <th className="sticky left-0 z-10 w-10 min-w-10 border-r border-border bg-muted px-2 py-1 text-right font-medium text-muted-foreground">
                  {rowIndex + 1}
                </th>
                {columns.map((columnIndex) => (
                  <td
                    key={columnIndex}
                    className="min-w-[120px] max-w-[260px] border-r border-border px-2 py-1 align-top leading-5 text-foreground last:border-r-0"
                  >
                    <span className="block whitespace-pre-wrap break-words">
                      {row[columnIndex] || ""}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficePreview({ file }: { file: WorkspaceFileResponse }) {
  const { t } = useLanguage();
  const preview = file.officePreview;
  const blocks = preview?.blocks || [];
  const hasContent = blocks.some(hasOfficeBlockContent);

  if (!preview || preview.error || !hasContent) {
    return <OfficeFallback message={preview?.error} />;
  }

  if (preview.kind === "docx") {
    return (
      <div className="scrollbar-subtle h-full w-full min-w-0 overflow-y-auto bg-muted/30">
        <div className="w-full min-w-0 px-4 py-5 sm:px-6">
          {preview.truncated && (
            <div className="mx-auto mb-4 max-w-[740px] rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground shadow-sm shadow-black/[0.025]">
              {t("previewTruncated")}
            </div>
          )}
          <article className="mx-auto min-h-[72vh] w-full max-w-[740px] rounded-md border border-border bg-background px-6 py-7 shadow-sm shadow-black/[0.04] sm:px-10 sm:py-10">
            <div className="space-y-7">
              {blocks.map((block, index) => (
                <section key={`${block.title}-${index}`} className="min-w-0">
                  {blocks.length > 1 && (
                    <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/70 pb-2">
                      <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {block.title}
                      </h3>
                      {block.truncated && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("truncated")}
                        </span>
                      )}
                    </div>
                  )}
                  <OfficeTextBlock block={block} documentMode />
                </section>
              ))}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-subtle h-full w-full min-w-0 overflow-y-auto">
      <div className="min-w-0 space-y-4 px-5 py-4">
        {preview.truncated && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            {t("previewTruncated")}
          </div>
        )}
        {blocks.map((block, index) => (
          <section
            key={`${block.title}-${index}`}
            className="min-w-0 rounded-md border border-border bg-card p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="truncate text-sm font-semibold leading-5">
                {block.title}
              </h3>
              {block.truncated && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("truncated")}
                </span>
              )}
            </div>
            {preview.kind === "xlsx" ? (
              <OfficeSheetBlock block={block} />
            ) : (
              <OfficeTextBlock block={block} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function summaryNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function meshMetadataNumber(mesh: CaeMeshPayload | null, key: string): number | null {
  return summaryNumber(mesh?.metadata?.[key]);
}

function meshMetadataBoolean(mesh: CaeMeshPayload | null, key: string): boolean {
  return mesh?.metadata?.[key] === true;
}

function formatSummaryValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries.map(([key, item]) => `${key}: ${formatSummaryValue(item)}`).join(", ")
      : "-";
  }
  return String(value);
}

function SummaryCard({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: Array<[string, unknown]>;
}) {
  const visibleItems = items.filter(([, value]) => value !== undefined);
  if (!visibleItems.length) return null;

  return (
    <section className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm shadow-sky-950/[0.04]">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-sky-950">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 text-sky-700">
          {icon}
        </span>
        {title}
      </div>
      <dl className="grid gap-2 text-xs">
        {visibleItems.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-medium text-foreground">
              {formatSummaryValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CaeMeshViewer({
  file,
  resourceId,
  workspaceId,
}: {
  file: WorkspaceFileResponse;
  resourceId?: string;
  workspaceId?: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<import("three").Group | null>(null);
  const cameraRef = useRef<import("three").PerspectiveCamera | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null
  );
  const [mesh, setMesh] = useState<CaeMeshPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);
    setMesh(null);
    fetchCaeMesh(file.path, resourceId, workspaceId)
      .then((payload) => {
        if (!isCancelled) setMesh(payload.mesh);
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "\u65e0\u6cd5\u751f\u6210 CAE 3D \u9884\u89c8\u3002"
          );
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [file.path, resourceId, workspaceId]);

  const resetView = useCallback(() => {
    const root = rootRef.current;
    const camera = cameraRef.current;
    if (!root || !camera) return;
    root.rotation.set(-0.42, 0.58, 0);
    camera.position.set(0, 0.15, 4.6);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !mesh) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function setup() {
      const THREE = await import("three");
      const activeMount = mountRef.current;
      if (!activeMount || disposed) return;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(activeMount.clientWidth || 1, activeMount.clientHeight || 1);
      activeMount.replaceChildren(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        42,
        (activeMount.clientWidth || 1) / (activeMount.clientHeight || 1),
        0.01,
        10000
      );
      cameraRef.current = camera;
      camera.position.set(0, 0.15, 4.6);

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const key = new THREE.DirectionalLight(0xdaf4ff, 2.2);
      key.position.set(3, 4, 5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x0ea5e9, 1.1);
      fill.position.set(-3, -2, 3);
      scene.add(fill);

      const root = new THREE.Group();
      root.rotation.set(-0.42, 0.58, 0);
      rootRef.current = root;
      scene.add(root);

      const modelGroup = new THREE.Group();
      root.add(modelGroup);

      const vertices = mesh.vertices || [];
      const faces = mesh.faces || [];
      const lines = mesh.lines || [];
      const facePositions: number[] = [];
      const edgePositions: number[] = [];
      const renderEdges = !meshMetadataBoolean(mesh, "downsampled") && faces.length <= 20_000;
      const addEdge = (a: number, b: number) => {
        if (!renderEdges) return;
        const va = vertices[a];
        const vb = vertices[b];
        if (!va || !vb) return;
        edgePositions.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
      };
      const addTri = (a: number, b: number, c: number) => {
        const va = vertices[a];
        const vb = vertices[b];
        const vc = vertices[c];
        if (!va || !vb || !vc) return;
        facePositions.push(
          va[0], va[1], va[2],
          vb[0], vb[1], vb[2],
          vc[0], vc[1], vc[2]
        );
      };

      faces.forEach((face) => {
        if (face.length >= 3) {
          addTri(face[0], face[1], face[2]);
          addEdge(face[0], face[1]);
          addEdge(face[1], face[2]);
          addEdge(face[2], face[0]);
        }
        if (face.length >= 4) {
          addTri(face[0], face[2], face[3]);
          addEdge(face[2], face[3]);
          addEdge(face[3], face[0]);
        }
      });
      lines.forEach((line) => line.length >= 2 && addEdge(line[0], line[1]));

      if (facePositions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(facePositions, 3));
        geometry.computeVertexNormals();
        modelGroup.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: 0x38bdf8,
              metalness: 0.08,
              opacity: 0.72,
              roughness: 0.45,
              side: THREE.DoubleSide,
              transparent: true,
            })
          )
        );
      }
      if (edgePositions.length) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
        modelGroup.add(
          new THREE.LineSegments(
            edgeGeometry,
            new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.72 })
          )
        );
      }
      if (!facePositions.length && vertices.length) {
        const pointGeometry = new THREE.BufferGeometry();
        pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flat(), 3));
        modelGroup.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: 0x0284c7, size: 0.035 })));
      }

      const box = new THREE.Box3().setFromObject(modelGroup);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      // Center the geometry inside a child group so root rotation stays around the model center.
      modelGroup.position.sub(center);
      const scale = 2.4 / Math.max(size.x, size.y, size.z, 0.001);
      root.scale.setScalar(scale);

      const grid = new THREE.GridHelper(3.2, 12, 0x7dd3fc, 0xdbeafe);
      grid.position.y = -1.25;
      scene.add(grid);

      const observer = new ResizeObserver(() => {
        if (!mountRef.current) return;
        const width = mountRef.current.clientWidth || 1;
        const height = mountRef.current.clientHeight || 1;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(activeMount);

      const animate = () => {
        if (disposed) return;
        if (!dragRef.current) root.rotation.y += 0.002;
        renderer.render(scene, camera);
        frameRef.current = requestAnimationFrame(animate);
      };
      frameRef.current = requestAnimationFrame(animate);

      cleanup = () => {
        observer.disconnect();
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        renderer.dispose();
        activeMount.replaceChildren();
      };
    }

    void setup().catch((err) => {
      setError(
        err instanceof Error
          ? err.message
          : "3D \u9884\u89c8\u6e32\u67d3\u5931\u8d25\u3002"
      );
    });
    return () => {
      disposed = true;
      cleanup?.();
      rootRef.current = null;
      cameraRef.current = null;
      dragRef.current = null;
    };
  }, [mesh]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !rootRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    root.rotation.y += dx * 0.008;
    root.rotation.x += dy * 0.008;
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const camera = cameraRef.current;
    if (!camera) return;
    event.preventDefault();
    camera.position.z = Math.max(1.2, Math.min(12, camera.position.z + event.deltaY * 0.006));
  }, []);

  const originalFaces = meshMetadataNumber(mesh, "original_faces");
  const previewFaces = meshMetadataNumber(mesh, "preview_faces") ?? mesh?.faces?.length ?? 0;
  const previewVertices = meshMetadataNumber(mesh, "preview_vertices") ?? mesh?.vertices?.length ?? 0;
  const isDownsampled = meshMetadataBoolean(mesh, "downsampled");

  return (
    <div
      className={`relative h-[42vh] min-h-[260px] overflow-hidden rounded-xl border border-sky-200 bg-[radial-gradient(circle_at_15%_10%,rgba(56,189,248,0.2),transparent_30%),linear-gradient(145deg,#eff6ff,#f8fbff)] ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={finishDrag}
      onPointerCancelCapture={finishDrag}
      onWheel={handleWheel}
    >
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute left-3 top-3 rounded-md border border-sky-200 bg-white/85 px-3 py-2 text-xs text-sky-950 shadow-sm backdrop-blur">
        <span className="font-semibold">3D CAE Viewer</span>
        <span className="ml-2 text-muted-foreground">
          {previewVertices.toLocaleString()} nodes / {previewFaces.toLocaleString()} faces
          {isDownsampled && originalFaces
            ? ` \u00b7 \u5feb\u901f\u9884\u89c8\uff0c\u539f\u59cb ${originalFaces.toLocaleString()} faces`
            : ""}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-3 top-3 h-8 w-8 bg-white/85 text-sky-800 hover:bg-white"
        onClick={resetView}
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
      {(isLoading || error || mesh?.checks?.length) && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-sky-200 bg-white/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {isLoading
            ? "\u6b63\u5728\u751f\u6210 3D \u9884\u89c8\uff1b\u5927\u6a21\u578b\u9996\u6b21\u6253\u5f00\u53ef\u80fd\u9700\u8981\u51e0\u5341\u79d2\uff0c\u7b2c\u4e8c\u6b21\u4f1a\u4f7f\u7528\u7f13\u5b58\u3002"
            : error || mesh?.checks?.[0]?.message}
        </div>
      )}
    </div>
  );
}

function CaeSummaryPreview({
  file,
  resourceId,
  workspaceId,
}: {
  file: WorkspaceFileResponse;
  resourceId?: string;
  workspaceId?: string;
}) {
  const [payload, setPayload] = useState<CaeSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);
    setPayload(null);

    fetchCaeSummary(file.path, resourceId, workspaceId)
      .then((summary) => {
        if (!isCancelled) setPayload(summary);
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "\u65e0\u6cd5\u751f\u6210 CAE \u6458\u8981\u3002"
          );
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [file.path, resourceId, workspaceId]);

  const summary = payload?.summary;
  const checks = summary?.checks || [];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-sky-50/40 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
        {"\u6b63\u5728\u751f\u6210 CAE \u6458\u8981\uff1b\u5927\u6587\u4ef6\u53ef\u80fd\u9700\u8981\u51e0\u5341\u79d2..."}
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="m-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error || "\u65e0\u6cd5\u751f\u6210 CAE \u6458\u8981\u3002"}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full bg-sky-50/30">
      <div className="space-y-4 p-5">
        <CaeMeshViewer
          file={file}
          resourceId={resourceId}
          workspaceId={workspaceId}
        />

        <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-600 to-blue-700 p-4 text-white shadow-sm shadow-sky-900/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-sky-100">CAE Summary</p>
              <h3 className="mt-1 text-lg font-semibold">CAE 摘要</h3>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs">
              {formatSummaryValue(summary.metadata?.parser_backend)}
            </span>
          </div>
        </div>

        <div className="grid gap-3">
          <SummaryCard
            icon={<Box className="h-4 w-4" />}
            title="Mesh"
            items={[
              ["Nodes", summary.mesh?.nodes],
              ["Elements", summary.mesh?.elements],
              ["Types", summary.mesh?.element_types],
              ["Properties", summary.mesh?.properties],
              ["Coords", summary.mesh?.coords],
            ]}
          />
          <SummaryCard
            icon={<Database className="h-4 w-4" />}
            title="Materials / Loads"
            items={[
              ["Materials", summary.materials?.count],
              ["Cards", summary.materials?.cards],
              ["Loads", summary.loads?.load_count],
              ["Constraints", summary.loads?.constraint_count],
              ["Subcases", summary.loads?.subcases],
            ]}
          />
          <SummaryCard
            icon={<RefreshCw className="h-4 w-4" />}
            title="Results / Geometry"
            items={[
              ["Tables", summary.results?.table_count],
              ["Results", summary.results?.result_tables || summary.results?.markers],
              ["Point data", summary.results?.point_data_count],
              ["Cell data", summary.results?.cell_data_count],
              ["Geometry", summary.geometry],
            ]}
          />
        </div>

        {checks.length > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Checks
            </div>
            <div className="space-y-2">
              {checks.map((check, index) => (
                <div key={`${check.message}-${index}`} className="rounded-md bg-white/70 px-3 py-2 text-xs text-amber-900">
                  <span className="mr-2 rounded-full bg-amber-200 px-2 py-0.5 font-semibold uppercase">
                    {check.severity || "info"}
                  </span>
                  {check.message}
                </div>
              ))}
            </div>
          </section>
        )}

        <details className="rounded-lg border border-border bg-card p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-muted-foreground">
            Raw JSON
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">
            {JSON.stringify(summary, null, 2)}
          </pre>
        </details>
      </div>
    </ScrollArea>
  );
}

export function WorkspaceViewer({
  selectedPath,
  resourceId,
  workspaceId,
  compact,
  onCollapse,
  onExpand,
  onClear,
  onResolvedPath,
}: WorkspaceViewerProps) {
  const { t } = useLanguage();
  const [file, setFile] = useState<WorkspaceFileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    fetchWorkspaceFile(selectedPath, resourceId, workspaceId)
      .then((payload) => {
        if (!isCancelled) {
          setFile(payload);
          if (payload.path && payload.path !== selectedPath) {
            onResolvedPath?.(payload.path);
          }
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setFile(null);
          setError(err instanceof Error ? err.message : t("unableToLoadFile"));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [onResolvedPath, resourceId, selectedPath, t, workspaceId]);

  const language = useMemo(() => {
    return file?.extension ? LANGUAGE_MAP[file.extension] || "text" : "text";
  }, [file?.extension]);

  async function openFileInSystemViewer() {
    if (!file || isOpeningFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      const response = await fetch("/api/workspace/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          resourceId,
          workspaceId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || t("unableToOpenLocalFile"));
      }
    } catch (openError) {
      const message =
        openError instanceof Error
          ? openError.message
          : t("unableToOpenLocalFile");
      toast.error(message);
    } finally {
      setIsOpeningFile(false);
    }
  }

  if (compact) {
    return (
      <div className="flex h-full w-full items-start justify-center border-l border-border bg-card/70 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
              aria-label={t("expandFilePreview")}
              onClick={onExpand}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            sideOffset={8}
            className="whitespace-nowrap"
          >
            {t("expandFilePreview")}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-card">
        <ViewerHeader
          title={t("filePreview")}
          onCollapse={onCollapse}
        />
        <EmptyViewer />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-card">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-5">
            {file?.name || selectedPath}
          </h2>
          <div className="flex shrink-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
            {file && <span>{formatBytes(file.size)}</span>}
            {file?.previewKind && (
              <span>{previewKindLabel(file.previewKind)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {file?.rawUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void openFileInSystemViewer()}
              disabled={isOpeningFile}
              aria-label={t("openWithSystemViewer")}
              title={t("openWithSystemViewer")}
            >
              {isOpeningFile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
            </Button>
          )}
          <ClearPreviewButton onClear={onClear} />
          <CollapsePreviewButton onCollapse={onCollapse} />
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loadingFile")}
          </div>
        )}

        {!isLoading && error && (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "pdf" && file.rawUrl && (
          <iframe
            src={file.rawUrl}
            title={file.path}
            className="h-full w-full border-0 bg-muted"
          />
        )}

        {!isLoading && !error && file?.previewKind === "image" && file.rawUrl && (
          <div className="flex h-full items-center justify-center bg-muted/30 p-6">
            <img
              src={file.rawUrl}
              alt={file.name}
              className="max-h-full max-w-full rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]"
            />
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "markdown" && (
          <ScrollArea className="h-full">
            <div className="px-6 py-5">
              <MarkdownContent content={file.content || ""} />
            </div>
          </ScrollArea>
        )}

        {!isLoading && !error && file?.previewKind === "molecule" && (
          <MoleculeViewer file={file} />
        )}

        {!isLoading && !error && file?.previewKind === "science" && (
          <ScienceSceneViewer file={file} />
        )}

        {!isLoading && !error && file?.previewKind === "cae" && (
          <CaeSummaryPreview
            file={file}
            resourceId={resourceId}
            workspaceId={workspaceId}
          />
        )}

        {!isLoading && !error && file?.previewKind === "text" && (
          <div className="h-full overflow-auto">
            <div className="min-w-0 p-4">
              {file.tooLarge ? (
                <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
                  {t("textFileTooLarge")}
                </div>
              ) : (
                <SyntaxHighlighter
                  language={language}
                  style={oneLight}
                  showLineNumbers
                  wrapLines
                  wrapLongLines
                  codeTagProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  lineProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  customStyle={{
                    margin: 0,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.8125rem",
                    minHeight: "100%",
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                    overflowX: "auto",
                    background: "hsl(var(--card))",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {file.content || ""}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        )}

        {!isLoading &&
          !error &&
          file &&
          isOfficePreviewKind(file.previewKind) && <OfficePreview file={file} />}

        {!isLoading &&
          !error &&
          file &&
          ![
            "image",
            "cae",
            "markdown",
            "molecule",
            "pdf",
            "science",
            "text",
          ].includes(file.previewKind) &&
          !isOfficePreviewKind(file.previewKind) && (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div className="max-w-xs rounded-md border border-border bg-muted p-5 text-sm text-muted-foreground">
                {t("unsupportedPreview")}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
