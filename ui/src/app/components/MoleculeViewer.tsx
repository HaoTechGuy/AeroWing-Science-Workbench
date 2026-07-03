"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GLViewer } from "3dmol";
import { Atom, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceFileResponse } from "@/app/types/workspace";
import { useLanguage } from "@/app/hooks/useLanguage";

type MoleculeStyleMode = "stick" | "sphere" | "cartoon";

const MOLECULE_FORMATS: Record<string, string> = {
  ".cif": "cif",
  ".cube": "cube",
  ".mcif": "cif",
  ".mmcif": "cif",
  ".mol": "sdf",
  ".mol2": "mol2",
  ".pdb": "pdb",
  ".pqr": "pqr",
  ".sdf": "sdf",
  ".xyz": "xyz",
};

const STYLE_OPTIONS: Array<{ value: MoleculeStyleMode; label: string }> = [
  { value: "stick", label: "Stick" },
  { value: "sphere", label: "Sphere" },
  { value: "cartoon", label: "Cartoon" },
];

function getMoleculeFormat(file: WorkspaceFileResponse): string | null {
  return file.extension ? MOLECULE_FORMATS[file.extension] || null : null;
}

function looksLikeMacromolecule(content: string): boolean {
  if (/^(HELIX|SHEET)\s/m.test(content)) {
    return true;
  }

  const atomRecords = content.match(/^ATOM\s+/gm)?.length ?? 0;
  const alphaCarbonRecords =
    content.match(/^ATOM\s+\d+\s+CA\s+/gm)?.length ?? 0;
  return atomRecords > 120 || alphaCarbonRecords > 20;
}

function getDefaultStyleMode(file: WorkspaceFileResponse): MoleculeStyleMode {
  const content = file.content || "";
  const extension = file.extension || "";
  if (
    [".cif", ".mcif", ".mmcif", ".pdb", ".pqr"].includes(extension) &&
    looksLikeMacromolecule(content)
  ) {
    return "cartoon";
  }
  return "stick";
}

function applyMoleculeStyle(
  viewer: GLViewer,
  mode: MoleculeStyleMode,
  isMacromolecule: boolean
) {
  if (mode === "sphere") {
    viewer.setStyle({}, {
      sphere: {
        colorscheme: "Jmol",
        scale: 0.36,
      },
    } as any);
    return;
  }

  if (mode === "cartoon") {
    if (isMacromolecule) {
      viewer.setStyle({}, {
        cartoon: {
          color: "spectrum",
        },
      } as any);
      viewer.setStyle(
        { hetflag: true } as any,
        {
          stick: {
            colorscheme: "Jmol",
            radius: 0.12,
          },
        } as any
      );
    } else {
      viewer.setStyle({}, {
        cartoon: {
          color: "spectrum",
        },
        stick: {
          colorscheme: "Jmol",
          radius: 0.12,
        },
      } as any);
    }
    return;
  }

  viewer.setStyle({}, {
    stick: {
      colorscheme: "Jmol",
      radius: 0.18,
    },
    sphere: {
      colorscheme: "Jmol",
      scale: 0.26,
    },
  } as any);
}

export function MoleculeViewer({ file }: { file: WorkspaceFileResponse }) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [styleMode, setStyleMode] = useState<MoleculeStyleMode>("stick");
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [atomCount, setAtomCount] = useState<number | null>(null);

  const format = useMemo(() => getMoleculeFormat(file), [file]);
  const content = file.content || "";
  const isMacromolecule = useMemo(
    () => looksLikeMacromolecule(content),
    [content]
  );
  const defaultStyleMode = useMemo(() => getDefaultStyleMode(file), [file]);

  useEffect(() => {
    setStyleMode(defaultStyleMode);
  }, [defaultStyleMode, file.path]);

  const resetView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.zoomTo();
    viewer.render();
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-molecule-controls="true"]')
      ) {
        return;
      }
      if (event.button !== 0 || !viewerRef.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setIsDragging(true);
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      const viewer = viewerRef.current;
      if (!dragState || !viewer || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - dragState.x;
      const deltaY = event.clientY - dragState.y;
      dragStateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };

      if (Math.abs(deltaX) > 0.1) {
        viewer.rotate(deltaX * 0.45, "y");
      }
      if (Math.abs(deltaY) > 0.1) {
        viewer.rotate(deltaY * 0.45, "x");
      }
      viewer.render();
    },
    []
  );

  const finishPointerDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (dragState?.pointerId === event.pointerId) {
        dragStateRef.current = null;
        setIsDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }
    },
    []
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    event.preventDefault();
    viewer.zoom(event.deltaY > 0 ? 0.9 : 1.1);
    viewer.render();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !format || !content || file.tooLarge) {
      return;
    }

    const moleculeFormat = format;
    let cancelled = false;
    setIsRendering(true);
    setError(null);
    setAtomCount(null);
    container.replaceChildren();

    async function renderMolecule() {
      const threeDMol = await import("3dmol");
      if (cancelled || !containerRef.current) {
        return;
      }

      const viewer = threeDMol.createViewer(containerRef.current, {
        backgroundColor: "white",
      });
      viewerRef.current = viewer;
      viewer.setBackgroundColor(0xffffff, 0);
      viewer.addModel(content, moleculeFormat);
      applyMoleculeStyle(viewer, styleMode, isMacromolecule);
      viewer.zoomTo();
      viewer.render();
      setAtomCount(viewer.selectedAtoms({}).length);

      requestAnimationFrame(() => {
        if (!cancelled) {
          viewer.resize();
          viewer.render();
        }
      });
    }

    void renderMolecule()
      .catch((renderError) => {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : t("moleculeRenderFailed")
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRendering(false);
        }
      });

    return () => {
      cancelled = true;
      dragStateRef.current = null;
      setIsDragging(false);
      viewerRef.current?.clear();
      viewerRef.current = null;
      container.replaceChildren();
    };
  }, [content, file.tooLarge, format, isMacromolecule, styleMode, t]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.resize();
      viewer.render();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  if (file.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-8 text-center">
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t("moleculeTooLarge")}
        </div>
      </div>
    );
  }

  if (!format || !content) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-8 text-center">
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t("moleculeReadFailed")}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full touch-none select-none overflow-hidden bg-[#f7fbfa]",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      data-molecule-viewer="true"
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={finishPointerDrag}
      onPointerCancelCapture={finishPointerDrag}
      onLostPointerCapture={() => {
        dragStateRef.current = null;
        setIsDragging(false);
      }}
      onWheel={handleWheel}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 touch-none select-none"
        aria-label={`${file.name} 3D molecule viewer`}
      />

      <div
        className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur"
        data-molecule-controls="true"
      >
        <div className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
          <Atom className="h-3.5 w-3.5" />
          3D
        </div>
        <div className="flex rounded-sm bg-muted/70 p-0.5">
          {STYLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                styleMode === option.value &&
                  "bg-card text-foreground shadow-sm"
              )}
              onClick={() => setStyleMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={resetView}
          aria-label={t("resetView")}
          title={t("resetView")}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-border/70 bg-card/90 px-3 py-2 text-xs leading-5 text-muted-foreground shadow-sm backdrop-blur">
        <span className="font-medium text-foreground">
          {format.toUpperCase()}
        </span>
        {atomCount !== null && <span className="ml-2">{atomCount} atoms</span>}
      </div>

      {(isRendering || error) && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 left-3 right-auto max-w-[70%] rounded-md border border-border/70 bg-card/95 px-3 py-2 text-xs leading-5 text-muted-foreground shadow-sm backdrop-blur">
          {isRendering ? t("moleculeRendering") : error}
        </div>
      )}
    </div>
  );
}
