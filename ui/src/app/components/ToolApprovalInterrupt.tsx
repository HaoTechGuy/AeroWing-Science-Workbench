"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Check, X, Pencil, Server, Terminal } from "lucide-react";
import type { ActionRequest, ReviewConfig } from "@/app/types/types";
import { cn } from "@/lib/utils";
import { getToolDisplayName } from "@/app/utils/toolDisplayNames";
import { useLanguage } from "@/app/hooks/useLanguage";

const REMOTE_COMPUTE_SUBMIT_TOOL = "remote_compute_submit_job";

interface ToolApprovalInterruptProps {
  actionRequest: ActionRequest;
  reviewConfig?: ReviewConfig;
  onResume: (value: any) => void;
  isLoading?: boolean;
}

interface BatchToolApprovalInterruptProps {
  actionRequests: ActionRequest[];
  reviewConfigs: ReviewConfig[];
  onResume: (value: any) => void;
  isLoading?: boolean;
}

function reviewConfigActionName(reviewConfig: ReviewConfig): string | undefined {
  return reviewConfig.actionName ?? reviewConfig.action_name;
}

function reviewConfigAllowedDecisions(
  reviewConfig: ReviewConfig | undefined
): string[] {
  return (
    reviewConfig?.allowedDecisions ??
    reviewConfig?.allowed_decisions ?? ["approve", "reject", "edit"]
  );
}

function remoteComputeSummary(args: Record<string, unknown>) {
  const outputGlobs = Array.isArray(args.output_globs)
    ? args.output_globs
    : Array.isArray(args.outputGlobs)
      ? args.outputGlobs
      : undefined;
  const host = args.host_id ?? args.hostId;
  return {
    host: host === undefined || host === null ? undefined : String(host),
    command: String(args.command || ""),
    outputGlobs,
    timeoutSeconds: args.timeout_seconds ?? args.timeoutSeconds,
    maxWaitSeconds: args.max_wait_seconds ?? args.maxWaitSeconds,
  };
}

export function ToolApprovalInterrupt({
  actionRequest,
  reviewConfig,
  onResume,
  isLoading,
}: ToolApprovalInterruptProps) {
  const { language, t } = useLanguage();
  const [rejectionMessage, setRejectionMessage] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState<Record<string, unknown>>({});
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const toolDisplayName = getToolDisplayName(actionRequest.name, language);

  const allowedDecisions = reviewConfigAllowedDecisions(reviewConfig);
  const isRemoteComputeApproval =
    actionRequest.name === REMOTE_COMPUTE_SUBMIT_TOOL;
  const remoteSummary = isRemoteComputeApproval
    ? remoteComputeSummary(actionRequest.args)
    : null;
  const remoteHost = remoteSummary?.host ?? t("remoteHost");
  const remoteTimeoutLabel = remoteSummary?.timeoutSeconds
    ? `${t("approvalTimeout")}: ${String(remoteSummary.timeoutSeconds)}s`
    : "";
  const remoteWaitLabel = remoteSummary?.maxWaitSeconds
    ? `${t("approvalWait")}: ${String(remoteSummary.maxWaitSeconds)}s`
    : "";

  const handleApprove = () => {
    onResume({
      decisions: [{ type: "approve" }],
    });
  };

  const handleReject = () => {
    if (showRejectionInput) {
      onResume({
        decisions: [
          {
            type: "reject",
            message: rejectionMessage.trim(),
          },
        ],
      });
    } else {
      setShowRejectionInput(true);
    }
  };

  const handleRejectConfirm = () => {
    onResume({
      decisions: [
        {
          type: "reject",
          message: rejectionMessage.trim(),
        },
      ],
    });
  };

  const handleEdit = () => {
    if (isEditing) {
      onResume({
        decisions: [
          {
            type: "edit",
            edited_action: {
              name: actionRequest.name,
              args: editedArgs,
            },
          },
        ],
      });
      setIsEditing(false);
      setEditedArgs({});
    }
  };

  const startEditing = () => {
    setIsEditing(true);
    setEditedArgs(JSON.parse(JSON.stringify(actionRequest.args)));
    setShowRejectionInput(false);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditedArgs({});
  };

  const updateEditedArg = (key: string, value: string) => {
    try {
      const parsedValue =
        value.trim().startsWith("{") || value.trim().startsWith("[")
          ? JSON.parse(value)
          : value;
      setEditedArgs((prev) => ({ ...prev, [key]: parsedValue }));
    } catch {
      setEditedArgs((prev) => ({ ...prev, [key]: value }));
    }
  };

  return (
    <div className="border-warning/30 bg-warning/10 w-full rounded-md border p-4 shadow-sm shadow-black/[0.025]">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <AlertCircle
          size={16}
          className="text-yellow-600 dark:text-yellow-400"
        />
        <span className="text-xs font-semibold uppercase tracking-wider">
          {t("approvalRequired")}
        </span>
      </div>

      {/* Description */}
      {isRemoteComputeApproval ? (
        <div className="mb-4 rounded-md border border-border bg-card p-3">
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">
              {t("runJobOnHost", { host: remoteHost })}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              {t("command")}
            </div>
            <pre className="max-h-44 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-5 text-foreground">
              {remoteSummary?.command}
            </pre>
            {remoteSummary?.outputGlobs && (
              <div className="text-xs text-muted-foreground">
                {t("outputs")}: {remoteSummary.outputGlobs.join(", ")}
              </div>
            )}
            {(remoteTimeoutLabel || remoteWaitLabel) && (
              <div className="text-xs text-muted-foreground">
                {remoteTimeoutLabel}
                {remoteTimeoutLabel && remoteWaitLabel ? " / " : null}
                {remoteWaitLabel}
              </div>
            )}
          </div>
        </div>
      ) : actionRequest.description ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {actionRequest.description}
        </p>
      ) : null}

      {/* Tool Info Card */}
      <div
        className={cn(
          "mb-4 rounded-md border border-border bg-card p-3"
        )}
      >
        <div className="mb-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("tool")}
          </span>
          <p className="mt-1 font-mono text-sm font-medium text-foreground">
            {toolDisplayName}
          </p>
        </div>

        {isEditing ? (
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("editArguments")}
            </span>
            <div className="mt-2 space-y-3">
              {Object.entries(actionRequest.args).map(([key, value]) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    {key}
                  </label>
                  <Textarea
                    value={
                      editedArgs[key] !== undefined
                        ? typeof editedArgs[key] === "string"
                          ? (editedArgs[key] as string)
                          : JSON.stringify(editedArgs[key], null, 2)
                        : typeof value === "string"
                        ? value
                        : JSON.stringify(value, null, 2)
                    }
                    onChange={(e) => updateEditedArg(key, e.target.value)}
                    className="font-mono text-xs"
                    rows={
                      typeof value === "string" && value.length < 100 ? 2 : 4
                    }
                    disabled={isLoading}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("arguments")}
            </span>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-muted/40 p-2 font-mono text-xs text-foreground">
              {JSON.stringify(actionRequest.args, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Rejection Message Input */}
      {showRejectionInput && !isEditing && (
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-foreground">
            {t("rejectionMessageOptional")}
          </label>
          <Textarea
            value={rejectionMessage}
            onChange={(e) => setRejectionMessage(e.target.value)}
            placeholder={t("rejectionPlaceholder")}
            className="text-sm"
            rows={2}
            disabled={isLoading}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={cancelEditing}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleEdit}
              disabled={isLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Check size={14} />
              {isLoading ? t("saving") : t("saveAndApprove")}
            </Button>
          </>
        ) : showRejectionInput ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowRejectionInput(false);
                setRejectionMessage("");
              }}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRejectConfirm}
              disabled={isLoading}
            >
              {isLoading ? t("rejecting") : t("confirmReject")}
            </Button>
          </>
        ) : (
          <>
            {allowedDecisions.includes("reject") && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={isLoading}
                className="text-destructive hover:bg-destructive/10"
              >
                <X size={14} />
                {t("reject")}
              </Button>
            )}
            {allowedDecisions.includes("edit") && (
              <Button
                variant="outline"
                size="sm"
                onClick={startEditing}
                disabled={isLoading}
              >
                <Pencil size={14} />
                {t("edit")}
              </Button>
            )}
            {allowedDecisions.includes("approve") && (
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isLoading}
                className={cn(
                  "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                <Check size={14} />
                {isLoading
                  ? t("approving")
                  : isRemoteComputeApproval
                    ? t("runJob")
                    : t("approve")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function BatchToolApprovalInterrupt({
  actionRequests,
  reviewConfigs,
  onResume,
  isLoading,
}: BatchToolApprovalInterruptProps) {
  const { language, t } = useLanguage();
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  const [rejectionMessage, setRejectionMessage] = useState("");
  const reviewConfigByName = new Map(
    reviewConfigs
      .map((config) => [reviewConfigActionName(config), config] as const)
      .filter(([name]) => Boolean(name))
  );
  const allAllowApprove = actionRequests.every((request) =>
    reviewConfigAllowedDecisions(reviewConfigByName.get(request.name)).includes(
      "approve"
    )
  );
  const allAllowReject = actionRequests.every((request) =>
    reviewConfigAllowedDecisions(reviewConfigByName.get(request.name)).includes(
      "reject"
    )
  );

  const submitDecision = (type: "approve" | "reject") => {
    onResume({
      decisions: actionRequests.map(() =>
        type === "reject"
          ? { type, message: rejectionMessage.trim() }
          : { type }
      ),
    });
  };

  return (
    <div className="w-full rounded-md border border-warning/30 bg-warning/10 p-4 shadow-sm shadow-black/[0.025]">
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <AlertCircle
          size={16}
          className="text-yellow-600 dark:text-yellow-400"
        />
        <span className="text-xs font-semibold uppercase tracking-wider">
          {t("approvalRequired")}
        </span>
      </div>

      <div className="mb-4 space-y-3">
        {actionRequests.map((request, index) => {
          const isRemoteCompute = request.name === REMOTE_COMPUTE_SUBMIT_TOOL;
          const remoteSummary = isRemoteCompute
            ? remoteComputeSummary(request.args)
            : null;
          return (
            <div
              key={`${request.name}-${index}`}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">
                  {index + 1}. {getToolDisplayName(request.name, language)}
                </div>
                {isRemoteCompute && (
                  <div className="text-xs text-muted-foreground">
                    {remoteSummary?.host ?? t("remoteHost")}
                  </div>
                )}
              </div>
              {request.description && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {request.description}
                </p>
              )}
              {isRemoteCompute ? (
                <pre className="max-h-36 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-5 text-foreground">
                  {remoteSummary?.command}
                </pre>
              ) : (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-xs leading-5 text-foreground">
                  {JSON.stringify(request.args, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      {showRejectionInput && (
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-foreground">
            {t("rejectionMessageOptional")}
          </label>
          <Textarea
            value={rejectionMessage}
            onChange={(event) => setRejectionMessage(event.target.value)}
            placeholder={t("rejectionBatchPlaceholder")}
            className="text-sm"
            rows={2}
            disabled={isLoading}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showRejectionInput ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowRejectionInput(false);
                setRejectionMessage("");
              }}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => submitDecision("reject")}
              disabled={isLoading || !allAllowReject}
            >
              {isLoading ? t("rejecting") : t("rejectAll")}
            </Button>
          </>
        ) : (
          <>
            {allAllowReject && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRejectionInput(true)}
                disabled={isLoading}
                className="text-destructive hover:bg-destructive/10"
              >
                <X size={14} />
                {t("rejectAll")}
              </Button>
            )}
            {allAllowApprove && (
              <Button
                size="sm"
                onClick={() => submitDecision("approve")}
                disabled={isLoading}
                className={cn(
                  "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                <Check size={14} />
                {isLoading ? t("approving") : t("approveAll")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
