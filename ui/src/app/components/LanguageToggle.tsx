"use client";

import { UI_LANGUAGES, type UiLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  language: UiLanguage;
  onChange: (language: UiLanguage) => void;
  compact?: boolean;
}

export function LanguageToggle({
  language,
  onChange,
  compact,
}: LanguageToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-background p-0.5",
        compact ? "h-8" : "h-9"
      )}
      role="group"
      aria-label="Language"
    >
      {UI_LANGUAGES.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "inline-flex h-full items-center justify-center rounded px-2 text-xs font-medium transition-colors",
            compact ? "min-w-8" : "min-w-12",
            language === item.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          aria-pressed={language === item.id}
          title={item.label}
        >
          {compact ? item.shortLabel : item.label}
        </button>
      ))}
    </div>
  );
}
