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
import { Switch } from "@/components/ui/switch";
import type { ResourceConfig } from "@/lib/config";

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
  return `~/internagents-workspaces/${host.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function RemoteConnectionDialog({
  open,
  onOpenChange,
  onConfigured,
}: RemoteConnectionDialogProps) {
  const [hosts, setHosts] = useState<SshHostEntry[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>("");
  const [label, setLabel] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [copyEnv, setCopyEnv] = useState(false);
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
          throw new Error(payload.error || "SSH Host 读取失败");
        }
        setHosts(payload.hosts || []);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "SSH Host 读取失败";
        toast.error(message);
      })
      .finally(() => setLoadingHosts(false));
  }, [open]);

  const canSubmit = useMemo(
    () =>
      Boolean(selectedHost.trim() && label.trim() && workspace.trim()) &&
      !settingUp,
    [label, selectedHost, settingUp, workspace]
  );

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

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/remote-connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: selectedHost }),
      });
      const payload = (await response.json()) as TestResult;
      setTestResult(payload);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.stderr || "SSH 连接失败");
      }
      toast.success("SSH 连接可用");
    } catch (error) {
      const message = error instanceof Error ? error.message : "SSH 连接失败";
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
          host: selectedHost,
          label,
          workspace,
          localPort: Number.isFinite(port) && port > 0 ? port : undefined,
          copyEnv,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/x-ndjson")) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "远程机器配置失败");
      }

      if (!response.body) {
        throw new Error("远程机器配置失败：服务器没有返回配置日志。");
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
            streamError = event.error || "远程机器配置失败";
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
        streamError = lastEvent.error || "远程机器配置失败";
      }

      if (streamError) {
        throw new Error(streamError);
      }
      const setupResult = result;
      if (!setupResult) {
        throw new Error("远程机器配置失败：未收到完成事件。");
      }

      setSetupLog(setupResult.log || []);
      await onConfigured(setupResult.resource, setupResult.resources);
      toast.success(`${setupResult.resource.label} 已接入`);
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "远程机器配置失败";
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
          <DialogTitle>添加远程工作区</DialogTitle>
          <DialogDescription>
            从本机 SSH config 选择可连接的 Host，测试通过后会通过 SSH 安装并启动
            InternAgents runtime，并把远端工作区路径加入工作区列表。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <Label>SSH config Host</Label>
            <Select
              value={selectedHost}
              onValueChange={applyHost}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingHosts ? "读取 SSH config..." : "选择 SSH Host"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {hosts.length === 0 && (
                  <div className="px-2 py-2 text-sm text-muted-foreground">
                    未在 ~/.ssh/config 读取到 Host
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
              只使用本机 ~/.ssh/config 的 Host；私钥和 HostName 由本机 ssh
              读取。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remote-label">工作区名称</Label>
            <Input
              id="remote-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="实验服务器"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="remote-workspace">远端工作区路径</Label>
            <Input
              id="remote-workspace"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder="~/internagents-workspaces/volcano"
            />
            <p className="text-xs text-muted-foreground">
              这里只放项目文件；runtime 会安装到远端独立目录，不会复制到工作区。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="local-port">本地 tunnel 端口（可选）</Label>
            <Input
              id="local-port"
              value={localPort}
              onChange={(event) => setLocalPort(event.target.value)}
              placeholder="自动选择，例如 22025"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-[#2F6868]" />
                同步本机 .env 到远端 runtime
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                可能包含模型 API Key。关闭时远端需要自己已有可用 .env，否则
                runtime 能启动但模型调用可能失败。
              </p>
            </div>
            <Switch
              checked={copyEnv}
              onCheckedChange={setCopyEnv}
            />
          </div>
        </div>

        {testResult && (
          <div
            className={`rounded-md border p-3 text-xs ${
              testResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <pre className="whitespace-pre-wrap bg-transparent p-0 font-mono text-inherit">
              {(testResult.stdout || testResult.stderr).trim()}
            </pre>
          </div>
        )}

        {setupLog.length > 0 && (
          <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-xs shadow-inner">
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2 font-medium text-zinc-100">
              <Terminal className="h-4 w-4" />
              配置日志
            </div>
            <div className="max-h-56 overflow-auto px-3 py-3 font-mono leading-5 text-emerald-100">
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
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={!selectedHost.trim() || testing || settingUp}
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            测试连接
          </Button>
          <Button
            type="button"
            onClick={setupConnection}
            disabled={!canSubmit}
            className="bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
          >
            {settingUp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            配置并选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
