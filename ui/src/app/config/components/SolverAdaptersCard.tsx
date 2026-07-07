"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCcw, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SolverStatus {
  available: boolean;
  path: string | null;
  hint: string | null;
}

interface SolverDetectResponse {
  checkedAt: string;
  solvers: Record<string, SolverStatus>;
}

const SOLVER_LABELS: Record<string, string> = {
  su2: "SU2",
  openfoam: "OpenFOAM",
  calculix: "CalculiX",
  nastran: "Nastran",
  abaqus: "Abaqus",
  optistruct: "OptiStruct",
};

export function SolverAdaptersCard() {
  const [payload, setPayload] = useState<SolverDetectResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/solvers/detect", { cache: "no-store" });
      const nextPayload = (await response.json()) as SolverDetectResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(nextPayload.error || "Solver detection failed.");
      }
      setPayload(nextPayload);
    } catch (detectError) {
      setError(
        detectError instanceof Error
          ? detectError.message
          : "Solver detection failed."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          检测本机 PATH 中的 CFD/FEM 求解器命令。这里仅做检测和准备，不会自动运行重型求解。
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(payload?.solvers || {}).map(([name, solver]) => (
          <div
            key={name}
            className="rounded-lg border border-border bg-background p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary">
                  <Wrench className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold">
                    {SOLVER_LABELS[name] || name}
                  </div>
                  <div className="mt-1 max-w-[18rem] truncate text-xs text-muted-foreground">
                    {solver.path || solver.hint || "Not detected"}
                  </div>
                </div>
              </div>
              <span
                className={
                  solver.available
                    ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                    : "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                }
              >
                {solver.available ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <TriangleAlert className="h-3 w-3" />
                )}
                {solver.available ? "可用" : "未检测到"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!payload && loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在检测求解器...
        </div>
      )}
    </div>
  );
}
