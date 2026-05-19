"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BookOpenText,
  Database,
  FileText,
  FolderSearch,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SOURCES = [
  {
    title: "项目文档",
    description: "接入仓库内 README、Markdown、PDF 和实验记录。",
    icon: FileText,
  },
  {
    title: "团队资料",
    description: "后续可连接共享盘、Notion、飞书或内部文档库。",
    icon: FolderSearch,
  },
  {
    title: "向量索引",
    description: "统一管理知识切片、索引状态和检索配置。",
    icon: Database,
  },
];

export default function KnowledgePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2"
          >
            <Link href="/?assistantId=agent">
              <ArrowLeft className="h-4 w-4" />
              工作台
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">团队知识库</h1>
            <div className="truncate text-xs text-muted-foreground">
              管理团队资料、项目文档和检索索引
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <BookOpenText className="h-5 w-5 text-[#2F6868]" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">知识库配置</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  这里会用于选择资料源、构建索引，并让 agent 在回答时引用团队知识。
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              disabled
              className="h-9"
            >
              <UploadCloud className="h-4 w-4" />
              添加资料
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {SOURCES.map((source) => {
              const Icon = source.icon;
              return (
                <div
                  key={source.title}
                  className="rounded-md border border-border/80 bg-background px-3 py-3"
                >
                  <Icon className="mb-2 h-4 w-4 text-[#2F6868]" />
                  <div className="text-sm font-medium">{source.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {source.description}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-dashed border-border bg-card px-5 py-8 text-center">
          <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-base font-semibold">暂未连接知识库</h2>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            下一步可以接入本地目录、云端文档或团队共享资料，并把检索工具加入 agent。
          </div>
        </section>
      </main>
    </div>
  );
}
