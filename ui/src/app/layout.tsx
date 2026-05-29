import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
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
        suppressHydrationWarning
      >
        <script src="/api/runtime/desktop-config" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
