import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { AppFooter } from "@/app/components/AppFooter";
import "katex/dist/katex.min.css";
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

const startupSplashDismissScript = `
(() => {
  const markReady = () => {
    document.body.dataset.internagentsStartup = "ready";
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      requestAnimationFrame(markReady);
    }, { once: true });
  } else {
    requestAnimationFrame(markReady);
  }
})();
`;

export const metadata = {
  title: "InternAgentS",
  description: "Local InternAgentS UI",
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
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <div
          id="internagents-startup-splash"
          className="internagents-startup-splash"
          role="status"
          aria-live="polite"
        >
          <span className="internagents-startup-splash__spinner" />
          <span>InternAgentS正在启动中...</span>
        </div>
        <script src="/api/runtime/desktop-config" />
        <NuqsAdapter>
          <div className="min-h-[calc(100vh-var(--app-footer-height))]">
            {children}
          </div>
        </NuqsAdapter>
        <AppFooter />
        <Toaster />
        <script
          dangerouslySetInnerHTML={{ __html: startupSplashDismissScript }}
        />
      </body>
    </html>
  );
}
