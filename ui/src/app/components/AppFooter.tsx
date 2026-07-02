"use client";

import { useLanguage } from "@/app/hooks/useLanguage";

export function AppFooter() {
  const { t } = useLanguage();

  return (
    <footer className="internagents-home flex h-[var(--app-footer-height)] items-center justify-center border-t border-border bg-background/95 px-4 text-xs text-muted-foreground">
      {t("labName")}
    </footer>
  );
}
