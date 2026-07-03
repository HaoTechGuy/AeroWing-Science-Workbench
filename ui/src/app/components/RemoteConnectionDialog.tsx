"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, ShieldCheck, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/app/hooks/useLanguage";
import type { ResourceConfig } from "@/lib/config";

type ConnectionMode = "sshConfig" | "sshCommand";
type RemoteInstallMode = "auto" | "venv" | "pythonPath" | "conda";

interface SshHostEntry {
  host: string;
  source: string;
}

interface TestResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface SetupResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  log: string[];
}

type SetupStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: SetupResult }
  | { type: "error"; error?: string };

interface RemoteConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured: (
    resource: ResourceConfig,
    resources: ResourceConfig[]
  ) => void | Promise<void>;
}

function labelFromHost(host: string): string {
  return (
    host.split(/[.@]/).filter(Boolean).slice(-1)[0]?.replace(/[-_]+/g, " ") ||
    host
  );
}

function defaultWorkspaceForHost(host: string): string {
  return `~/internagents-projects/${host.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function labelFromSshCommand(command: string): string {
  const parts = command.trim().split(/\s+/);
  const target = [...parts]
    .reverse()
    .find((part) => !part.startsWith("-") && part !== "ssh");
  return target ? labelFromHost(target) : "";
}

export function RemoteConnectionDialog({
  open,
  onOpenChange,
  onConfigured,
}: RemoteConnectionDialogProps) {
  const { t } = useLanguage();
  const [hosts, setHosts] = useState<SshHostEntry[]>([]);
  const [connectionMode, setConnectionMode] =
    useState<ConnectionMode>("sshConfig");
  const [selectedHost, setSelectedHost] = useState<string>("");
  const [sshCommand, setSshCommand] = useState("");
  const [label, setLabel] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [installMode, setInstallMode] = useState<RemoteInstallMode>("auto");
  const [pythonPath, setPythonPath] = useState("");
  const [condaCommand, setCondaCommand] = useState("");
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [setupLog, setSetupLog] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoadingHosts(true);
    fetch("/api/remote-connections/ssh-hosts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          hosts?: SshHostEntry[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || t("sshHostReadFailed"));
        }
        setHosts(payload.hosts || []);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : t("sshHostReadFailed");
        toast.error(message);
      })
      .finally(() => setLoadingHosts(false));
  }, [open, t]);

  const connectionReady =
    connectionMode === "sshConfig" ? selectedHost.trim() : sshCommand.trim();
  const installReady =
    installMode !== "pythonPath" || Boolean(pythonPath.trim());
  const canSubmit = useMemo(
    () =>
      Boolean(
        connectionReady && label.trim() && workspace.trim() && installReady
      ) &&
      !settingUp,
    [connectionReady, installReady, label, settingUp, workspace]
  );

  function switchConnectionMode(mode: ConnectionMode) {
    setConnectionMode(mode);
    setTestResult(null);
    setSetupLog([]);
  }

  function applyHost(host: string) {
    setSelectedHost(host);
    if (!label.trim()) {
      setLabel(labelFromHost(host));
    }
    if (!workspace.trim()) {
      setWorkspace(defaultWorkspaceForHost(host));
    }
    setTestResult(null);
    setSetupLog([]);
  }

  function applySshCommand(command: string) {
    setSshCommand(command);
    const derivedLabel = labelFromSshCommand(command);
    if (derivedLabel && !label.trim()) {
      setLabel(derivedLabel);
    }
    if (derivedLabel && !workspace.trim()) {
      setWorkspace(defaultWorkspaceForHost(derivedLabel));
    }
    setTestResult(null);
    setSetupLog([]);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/remote-connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionMode,
          host: connectionMode === "sshConfig" ? selectedHost : undefined,
          sshCommand: connectionMode === "sshCommand" ? sshCommand : undefined,
        }),
      });
      const payload = (await response.json()) as TestResult;
      setTestResult(payload);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.stderr || t("sshConnectionFailed"));
      }
      toast.success(t("sshConnectionReady"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("sshConnectionFailed");
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  async function setupConnection() {
    if (!canSubmit) return;
    setSettingUp(true);
    setSetupLog([]);
    try {
      const port = Number.parseInt(localPort, 10);
      const response = await fetch("/api/remote-connections/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionMode,
          host: connectionMode === "sshConfig" ? selectedHost : undefined,
          sshCommand: connectionMode === "sshCommand" ? sshCommand : undefined,
          label,
          workspace,
          localPort: Number.isFinite(port) && port > 0 ? port : undefined,
          installMode,
          pythonPath: pythonPath.trim() || undefined,
          condaCommand: condaCommand.trim() || undefined,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/x-ndjson")) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || t("remoteSetupFailed"));
      }

      if (!response.body) {
        throw new Error(t("remoteSetupNoLog"));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: SetupResult | null = null;
      let streamError: string | null = null;

      const parseLine = (line: string): SetupStreamEvent | null => {
        const trimmed = line.trim();
        return trimmed ? (JSON.parse(trimmed) as SetupStreamEvent) : null;
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const event = parseLine(line);
          if (!event) {
            continue;
          }
          if (event.type === "log" && event.message) {
            setSetupLog((log) => [...log, event.message as string]);
          } else if (event.type === "done" && event.result) {
            result = event.result;
          } else if (event.type === "error") {
            streamError = event.error || t("remoteSetupFailed");
          }
        }
        if (done) break;
      }
      const lastEvent = parseLine(buffer);
      if (lastEvent?.type === "log" && lastEvent.message) {
        setSetupLog((log) => [...log, lastEvent.message as string]);
      } else if (lastEvent?.type === "done" && lastEvent.result) {
        result = lastEvent.result;
      } else if (lastEvent?.type === "error") {
        streamError = lastEvent.error || t("remoteSetupFailed");
      }

      if (streamError) {
        throw new Error(streamError);
      }
      const setupResult = result;
      if (!setupResult) {
        throw new Error(t("remoteSetupNoResult"));
      }

      setSetupLog(setupResult.log || []);
      await onConfigured(setupResult.resource, setupResult.resources);
      toast.success(
        t("remoteProjectConnectedToast", { label: setupResult.resource.label })
      );
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("remoteSetupFailed");
      setSetupLog((log) => [...log, message]);
      toast.error(message);
    } finally {
      setSettingUp(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("remoteConnectionTitle")}</DialogTitle>
          <DialogDescription>
            {t("remoteConnectionDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => switchConnectionMode("sshConfig")}
            className={`rounded-lg border p-3 text-left transition ${
              connectionMode === "sshConfig"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            }`}
          >
            <div className="text-sm font-semibold">
              {t("remoteConnectionSshConfigTitle")}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("remoteConnectionSshConfigDescription")}
            </div>
          </button>
          <button
            type="button"
            onClick={() => switchConnectionMode("sshCommand")}
            className={`rounded-lg border p-3 text-left transition ${
              connectionMode === "sshCommand"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-accent"
            }`}
          >
            <div className="text-sm font-semibold">
              {t("remoteConnectionCommandTitle")}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("remoteConnectionCommandDescription")}
            </div>
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          {connectionMode === "sshConfig" ? (
            <div className="space-y-2">
              <Label>{t("sshConfigHostLabel")}</Label>
              <Select
                value={selectedHost}
                onValueChange={applyHost}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingHosts
                        ? t("sshConfigLoading")
                        : t("sshConfigChooseHost")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {hosts.length === 0 && (
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      {t("sshConfigNoHosts")}
                    </div>
                  )}
                  {hosts.map((host) => (
                    <SelectItem
                      key={host.host}
                      value={host.host}
                    >
                      {host.host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("sshConfigHostHelp")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="ssh-command">{t("sshCommandLabel")}</Label>
              <Input
                id="ssh-command"
                value={sshCommand}
                onChange={(event) => applySshCommand(event.target.value)}
                placeholder="ssh -p 2222 user@example.com"
              />
              <p className="text-xs text-muted-foreground">
                {t("sshCommandHelp")}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="remote-label">{t("remoteDisplayName")}</Label>
            <Input
              id="remote-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("remoteDisplayNamePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="remote-workspace">{t("remoteWorkspaceLabel")}</Label>
            <Input
              id="remote-workspace"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder="~/internagents-projects/volcano"
            />
            <p className="text-xs text-muted-foreground">
              {t("remoteWorkspaceHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="local-port">{t("localPortLabel")}</Label>
            <Input
              id="local-port"
              value={localPort}
              onChange={(event) => setLocalPort(event.target.value)}
              placeholder={t("localPortPlaceholder")}
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">
              {t("localPortHelp")}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-3">
            <div className="text-sm font-semibold">
              {t("advancedInstallOptions")}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("advancedInstallHelp")}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <div className="space-y-2">
              <Label>{t("installModeLabel")}</Label>
              <Select
                value={installMode}
                onValueChange={(value) =>
                  setInstallMode(value as RemoteInstallMode)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("installAuto")}</SelectItem>
                  <SelectItem value="venv">{t("installVenv")}</SelectItem>
                  <SelectItem value="pythonPath">
                    {t("installPythonPath")}
                  </SelectItem>
                  <SelectItem value="conda">{t("installConda")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="remote-python-path">
                {t("customPythonPath")}
                {installMode === "pythonPath" ? "" : t("optionalSuffix")}
              </Label>
              <Input
                id="remote-python-path"
                value={pythonPath}
                onChange={(event) => setPythonPath(event.target.value)}
                placeholder="/opt/python3.12/bin/python3"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="remote-conda-command">
                {t("condaCommandLabel")}
              </Label>
              <Input
                id="remote-conda-command"
                value={condaCommand}
                onChange={(event) => setCondaCommand(event.target.value)}
                placeholder={t("condaCommandPlaceholder")}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {t("condaCommandHelp")}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-primary" />
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium">
                {t("autoSyncLocalConfigTitle")}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("autoSyncLocalConfigHelp")}
              </p>
            </div>
          </div>
        </div>

        {testResult && (
          <div
            className={`rounded-md border p-3 text-xs ${
              testResult.ok
                ? "border-primary/25 bg-primary/10 text-primary dark:border-primary/35 dark:bg-primary/15 dark:text-[hsl(var(--primary))]"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <pre className="whitespace-pre-wrap bg-transparent p-0 font-mono text-inherit">
              {(testResult.stdout || testResult.stderr).trim()}
            </pre>
          </div>
        )}

        {setupLog.length > 0 && (
          <div className="overflow-hidden rounded-md border border-[#332941] bg-[#0d0b12] text-xs shadow-inner">
            <div className="flex items-center gap-2 border-b border-[#332941] bg-[#17121f] px-3 py-2 font-medium text-[#f7f3fb]">
              <Terminal className="h-4 w-4" />
              {t("setupLog")}
            </div>
            <div className="max-h-56 overflow-auto px-3 py-3 font-mono leading-5 text-[#efe7fb]">
              {setupLog.map((line, index) => (
                <div
                  key={`${index}-${line.slice(0, 24)}`}
                  className="whitespace-pre-wrap break-words"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={settingUp}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={!connectionReady || testing || settingUp}
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("testConnection")}
          </Button>
          <Button
            type="button"
            onClick={setupConnection}
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {settingUp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("connectAndStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
