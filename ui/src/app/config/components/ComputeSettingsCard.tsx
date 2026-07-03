"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCcw,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SshComputeProbe {
  ok: boolean;
  checkedAt: string;
  os?: string;
  kernel?: string;
  arch?: string;
  user?: string;
  host?: string;
  python?: string;
  bash?: string;
  workdir?: string;
  error?: string;
}

interface SshComputeHost {
  id: string;
  label: string;
  hostAlias?: string;
  sshCommand: string;
  scratchRoot: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  probe?: SshComputeProbe;
}

interface SshConfigHostEntry {
  host: string;
  source: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

export function ComputeSettingsCard() {
  const [hosts, setHosts] = useState<SshComputeHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHostEntry[]>(
    []
  );
  const [sshConfigError, setSshConfigError] = useState<string | null>(null);
  const [hostAlias, setHostAlias] = useState("");
  const [hostNotes, setHostNotes] = useState("");
  const [selectedHostId, setSelectedHostId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) || hosts[0],
    [hosts, selectedHostId]
  );

  async function refreshHosts() {
    const [configResponse, computeResponse] = await Promise.all([
      fetch("/api/remote-connections/ssh-hosts", { cache: "no-store" }),
      fetch("/api/compute/ssh-hosts", { cache: "no-store" }),
    ]);
    if (configResponse.ok) {
      const configPayload = (await configResponse.json()) as {
        hosts: SshConfigHostEntry[];
      };
      setSshConfigHosts(configPayload.hosts);
      setSshConfigError(null);
      if (!hostAlias && configPayload.hosts[0]) {
        setHostAlias(configPayload.hosts[0].host);
      }
    } else {
      const payload = await configResponse.json().catch(() => ({}));
      setSshConfigHosts([]);
      setSshConfigError(payload.error || "Unable to read ~/.ssh/config.");
    }

    const computePayload = await readJsonResponse<{ hosts: SshComputeHost[] }>(
      computeResponse
    );
    setHosts(computePayload.hosts);
    if (!selectedHostId && computePayload.hosts[0]) {
      setSelectedHostId(computePayload.hosts[0].id);
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshHosts();
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : "Refresh failed.";
      setError(message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  async function addHost() {
    const host = hostAlias.trim();
    if (!host) {
      toast.error("Enter a Host alias from ~/.ssh/config.");
      return;
    }
    setAddingHost(true);
    setError(null);
    try {
      const response = await fetch("/api/compute/ssh-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          notes: hostNotes.trim() || undefined,
        }),
      });
      const payload = await readJsonResponse<{ host: SshComputeHost }>(
        response
      );
      setHosts((current) => [
        payload.host,
        ...current.filter((candidate) => candidate.id !== payload.host.id),
      ]);
      setSelectedHostId(payload.host.id);
      setHostNotes("");
      toast.success("SSH compute host connected.");
    } catch (hostError) {
      const message =
        hostError instanceof Error ? hostError.message : "Host setup failed.";
      setError(message);
      toast.error(message);
    } finally {
      setAddingHost(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Linux SSH hosts for remote compute approvals. Job submission happens
          from the conversation permission card, not from Settings.
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-[#ff6d8d]/35 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">SSH hosts</h3>
        </div>
        <div className="mb-3 space-y-2 text-sm text-muted-foreground">
          <p>
            Pick a host alias from your local <code>~/.ssh/config</code>, or
            type one. The address, user, port, ProxyJump, and key come from SSH;
            credentials are not copied into this app.
          </p>
          {sshConfigError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-[#f5b85b]/35 dark:bg-[#f5b85b]/10 dark:text-[#ffe0aa]">
              No readable <code>~/.ssh/config</code> was found. Define a{" "}
              <code>Host &lt;alias&gt;</code> block first, then refresh Compute.
            </div>
          ) : sshConfigHosts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-2">
              No SSH config hosts found yet.
            </div>
          ) : null}
        </div>
        <div className="grid gap-3">
          <div className="space-y-2">
            <Label htmlFor="compute-host-alias">Host alias</Label>
            <Input
              id="compute-host-alias"
              list="compute-ssh-config-hosts"
              value={hostAlias}
              autoComplete="off"
              placeholder="e.g. biowulf, lab-gpu, rd"
              onChange={(event) => setHostAlias(event.target.value)}
            />
            <datalist id="compute-ssh-config-hosts">
              {sshConfigHosts.map((host) => (
                <option key={host.host} value={host.host} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="compute-host-notes">
              Anything the agent should know? (optional)
            </Label>
            <Textarea
              id="compute-host-notes"
              value={hostNotes}
              placeholder="How do jobs run here: sbatch, qsub, or bash? Is it OK to install packages? Any partition, account, module, or environment path to use?"
              onChange={(event) => setHostNotes(event.target.value)}
              className="min-h-24"
            />
          </div>
        </div>
        <Button
          type="button"
          className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => void addHost()}
          disabled={addingHost}
        >
          {addingHost ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add SSH host
        </Button>

        <div className="mt-4 grid gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading compute hosts...
            </div>
          ) : hosts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No SSH compute hosts yet.
            </div>
          ) : (
            hosts.map((host) => (
              <button
                key={host.id}
                type="button"
                onClick={() => setSelectedHostId(host.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition hover:border-primary/50 hover:bg-accent",
                  selectedHost?.id === host.id
                    ? "border-primary ring-2 ring-primary/15"
                    : "border-border"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-sm font-semibold">
                    {host.hostAlias || host.label}
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      host.probe?.ok
                        ? "bg-primary/10 text-primary"
                        : "bg-red-50 text-red-700 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]"
                    )}
                  >
                    {host.probe?.ok ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {host.probe?.ok ? "Linux ready" : "Probe failed"}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-3">
                  <span>OS: {host.probe?.os || "-"}</span>
                  <span>Arch: {host.probe?.arch || "-"}</span>
                  <span>Python: {host.probe?.python || "-"}</span>
                </div>
                {host.notes && (
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    {host.notes}
                  </div>
                )}
                {host.probe?.error && (
                  <div className="mt-2 text-xs text-red-700 dark:text-[#ffc7d4]">
                    {host.probe.error}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
