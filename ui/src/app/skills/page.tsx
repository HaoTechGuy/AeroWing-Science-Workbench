import { Suspense } from "react";
import { SkillsMarketplace } from "@/app/skills/components/SkillsMarketplace";

export default function SkillsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <SkillsMarketplace />
    </Suspense>
  );
}
