"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { SubAgent } from "@/app/types/types";
import { getToolDisplayName } from "@/app/utils/toolDisplayNames";

interface SubAgentIndicatorProps {
  subAgent: SubAgent;
  onClick: () => void;
  isExpanded?: boolean;
}

export const SubAgentIndicator = React.memo<SubAgentIndicatorProps>(
  ({ subAgent, onClick, isExpanded = true }) => {
    return (
      <div className="w-fit max-w-[70vw] overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/[0.025] outline-none">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          className="flex w-full items-center justify-between gap-2 border-none px-4 py-2 text-left shadow-none outline-none transition-colors duration-200 hover:bg-accent/60"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-sans text-sm font-semibold leading-[140%] text-foreground">
                {getToolDisplayName(subAgent.subAgentName)}
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
