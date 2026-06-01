import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { QuickstartTour } from "@/components/onboarding/QuickstartTour";
import { WaterRippleIntro } from "@/components/WaterRippleIntro";
import "./globals.css";

const themeBootstrapScript = `
(() => {
  try {
    const theme = localStorage.getItem("internagents.theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-joy-color-scheme", theme);
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export const metadata = {
  title: "InternAgents",
  description: "Local InternAgents UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-background text-foreground"
        suppressHydrationWarning
      >
        <script src="/api/runtime/desktop-config" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <WaterRippleIntro />
        <NuqsAdapter>
          <div className="min-h-[calc(100vh-var(--app-footer-height))]">
            {children}
          </div>
        </NuqsAdapter>
        <footer className="flex h-[var(--app-footer-height)] items-center justify-center border-t border-border bg-background/95 px-4 text-[11px] text-muted-foreground">
          上海人工智能实验室
        </footer>
        <QuickstartTour />
        <Toaster />
      </body>
    </html>
  );
}
