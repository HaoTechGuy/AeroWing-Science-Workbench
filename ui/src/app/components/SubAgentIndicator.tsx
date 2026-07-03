"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SubAgent } from "@/app/types/types";
import { getToolDisplayName } from "@/app/utils/toolDisplayNames";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/app/hooks/useLanguage";

interface SubAgentIndicatorProps {
  subAgent: SubAgent;
  onClick: () => void;
  isExpanded?: boolean;
  muted?: boolean;
}

export const SubAgentIndicator = React.memo<SubAgentIndicatorProps>(
  ({ subAgent, onClick, isExpanded = true, muted = false }) => {
    const { language } = useLanguage();
    return (
      <div
        className={cn(
          "w-fit max-w-[70vw] overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/[0.025] outline-none",
          muted &&
            "border-border/30 bg-muted/5 text-muted-foreground/70 shadow-none"
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          className={cn(
            "flex w-full items-center justify-between gap-2 border-none px-4 py-2 text-left shadow-none outline-none transition-colors duration-200 hover:bg-accent/60",
            muted && "hover:bg-muted/10"
          )}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-sans text-sm font-semibold leading-[140%] text-foreground",
                  muted && "text-muted-foreground/70"
                )}
              >
                {getToolDisplayName(subAgent.subAgentName, language)}
              </span>
            </div>
            {isExpanded ? (
              <ChevronUp
                size={14}
                className="shrink-0 text-muted-foreground"
              />
            ) : (
              <ChevronDown
                size={14}
                className="shrink-0 text-muted-foreground"
              />
            )}
          </div>
        </Button>
      </div>
    );
  }
);

SubAgentIndicator.displayName = "SubAgentIndicator";
