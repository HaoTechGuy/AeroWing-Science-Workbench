"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { FileText } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
  onOpenWorkspacePath?: (path: string) => void;
}

const OUTPUT_FILE_PATTERN =
  /((?:输出文件|输出文档|输出路径|Output file)\s*[:：]\s*)(\/[^\s`<>"'，。；;、)）\]}]+)/gi;
const WORKSPACE_FILE_PATH_PATTERN =
  /^\/[^\r\n]+\.(?:csv|doc|docx|html|jpeg|jpg|json|md|markdown|pdf|png|ppt|pptx|txt|xls|xlsx|xml|yaml|yml)$/i;

function isPreviewableWorkspacePath(value: string): boolean {
  return WORKSPACE_FILE_PATH_PATTERN.test(value.trim());
}

function WorkspacePathButton({
  path,
  onOpenWorkspacePath,
}: {
  path: string;
  onOpenWorkspacePath: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-1.5 py-0.5 align-baseline font-mono text-[0.9em] font-medium text-primary shadow-sm shadow-black/[0.025] transition-colors hover:border-primary/60 hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`打开 ${path}`}
      onClick={() => onOpenWorkspacePath(path)}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-all">{path}</span>
      <span className="ml-0.5 shrink-0 rounded-sm bg-primary/15 px-1 py-px font-sans text-[0.7rem] font-semibold leading-none">
        打开
      </span>
    </button>
  );
}

function linkifyOutputFileText(
  text: string,
  onOpenWorkspacePath: (path: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(OUTPUT_FILE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const prefix = match[1] ?? "";
    const workspacePath = match[2] ?? "";
    if (!workspacePath) {
      continue;
    }

    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }
    nodes.push(prefix);
    nodes.push(
      <WorkspacePathButton
        key={`${workspacePath}-${matchIndex}`}
        path={workspacePath}
        onOpenWorkspacePath={onOpenWorkspacePath}
      />
    );
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex === 0) {
    return [text];
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function linkifyOutputFileChildren(
  children: React.ReactNode,
  onOpenWorkspacePath?: (path: string) => void
): React.ReactNode {
  if (!onOpenWorkspacePath) {
    return children;
  }

  return React.Children.toArray(children).flatMap((child) =>
    typeof child === "string"
      ? linkifyOutputFileText(child, onOpenWorkspacePath)
      : child
  );
}

export const MarkdownContent = React.memo<MarkdownContentProps>(
  ({ content, className = "", onOpenWorkspacePath }) => {
    return (
      <div
        className={cn(
          "prose min-w-0 max-w-full overflow-hidden break-words text-sm leading-relaxed text-inherit [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-2 [&_h1:first-child]:mt-0 [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:font-semibold [&_h2:first-child]:mt-0 [&_h2]:mb-4 [&_h2]:mt-6 [&_h2]:font-semibold [&_h3:first-child]:mt-0 [&_h3]:mb-4 [&_h3]:mt-6 [&_h3]:font-semibold [&_h4:first-child]:mt-0 [&_h4]:mb-4 [&_h4]:mt-6 [&_h4]:font-semibold [&_h5:first-child]:mt-0 [&_h5]:mb-4 [&_h5]:mt-6 [&_h5]:font-semibold [&_h6:first-child]:mt-0 [&_h6]:mb-4 [&_h6]:mt-6 [&_h6]:font-semibold [&_p:last-child]:mb-0 [&_p]:mb-4",
          className
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p({ children }: { children?: React.ReactNode }) {
              return (
                <p>{linkifyOutputFileChildren(children, onOpenWorkspacePath)}</p>
              );
            },
            code({
              className,
              children,
              ...props
            }: {
              className?: string;
              children?: React.ReactNode;
            }) {
              const codeText = String(children).replace(/\n$/, "");
              const match = /language-(\w+)/.exec(className || "");
              return match ? (
                <SyntaxHighlighter
                  style={oneLight}
                  language={match[1]}
                  PreTag="div"
                  className="max-w-full rounded-md border border-border text-sm"
                  wrapLines={true}
                  wrapLongLines={true}
                  lineProps={{
                    style: {
                      wordBreak: "break-all",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "break-word",
                    },
                  }}
                  customStyle={{
                    margin: 0,
                    maxWidth: "100%",
                    overflowX: "auto",
                    fontSize: "0.875rem",
                    background: "hsl(var(--card))",
                  }}
                >
                  {codeText}
                </SyntaxHighlighter>
              ) : !match &&
                onOpenWorkspacePath &&
                isPreviewableWorkspacePath(codeText) ? (
                <WorkspacePathButton
                  path={codeText.trim()}
                  onOpenWorkspacePath={onOpenWorkspacePath}
                />
              ) : (
                <code
                  className="bg-surface rounded-sm px-1 py-0.5 font-mono text-xs"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre({ children }: { children?: React.ReactNode }) {
              return (
                <div className="my-4 max-w-full overflow-hidden last:mb-0">
                  {children}
                </div>
              );
            },
            a({
              href,
              children,
            }: {
              href?: string;
              children?: React.ReactNode;
            }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary no-underline hover:underline"
                >
                  {children}
                </a>
              );
            },
            blockquote({ children }: { children?: React.ReactNode }) {
              return (
                <blockquote className="text-primary/50 my-4 border-l-4 border-border pl-4 italic">
                  {children}
                </blockquote>
              );
            },
            ul({ children }: { children?: React.ReactNode }) {
              return (
                <ul className="my-4 pl-6 [&>li:last-child]:mb-0 [&>li]:mb-1">
                  {children}
                </ul>
              );
            },
            ol({ children }: { children?: React.ReactNode }) {
              return (
                <ol className="my-4 pl-6 [&>li:last-child]:mb-0 [&>li]:mb-1">
                  {children}
                </ol>
              );
            },
            table({ children }: { children?: React.ReactNode }) {
              return (
                <div className="my-4 overflow-x-auto">
                  <table className="[&_th]:bg-surface w-full border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold">
                    {children}
                  </table>
                </div>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkdownContent.displayName = "MarkdownContent";
