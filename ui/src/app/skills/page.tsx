"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function SkillsRedirect() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    window.location.replace(
      `/config${query ? `?${query}` : ""}#settings-skills`
    );
  }, [searchParams]);

  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}

export default function SkillsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SkillsRedirect />
    </Suspense>
  );
}
