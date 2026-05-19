import useSWRInfinite from "swr/infinite";
import type { Thread } from "@langchain/langgraph-sdk";
import { useRemoteAgent } from "@/providers/ClientProvider";

export interface ThreadItem {
  id: string;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  assistantId?: string;
  metadata: Record<string, unknown>;
  archived: boolean;
}

const DEFAULT_PAGE_SIZE = 20;

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
}) {
  const remoteAgent = useRemoteAgent();
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      if (previousPageData && previousPageData.length === 0) {
        return null;
      }

      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: remoteAgent.url,
        assistantId: remoteAgent.graphName,
        status: props?.status,
      };
    },
    async ({
      assistantId,
      status,
      pageIndex,
      pageSize,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      status?: Thread["status"];
    }) => {
      const threads = await remoteAgent.searchThreads({
        limit: pageSize,
        offset: pageIndex * pageSize,
        status,
      });

      return threads
        .map((thread): ThreadItem => {
          let title = "Untitled Thread";
          let description = "";
          const metadata =
            thread.metadata && typeof thread.metadata === "object"
              ? (thread.metadata as Record<string, unknown>)
              : {};

          try {
            if (thread.values && typeof thread.values === "object") {
              const values = thread.values as any;
              const firstHumanMessage = values.messages.find(
                (m: any) => m.type === "human"
              );
              if (firstHumanMessage?.content) {
                const content =
                  typeof firstHumanMessage.content === "string"
                    ? firstHumanMessage.content
                    : firstHumanMessage.content[0]?.text || "";
                title =
                  content.slice(0, 50) + (content.length > 50 ? "..." : "");
              }
              const firstAiMessage = values.messages.find(
                (m: any) => m.type === "ai"
              );
              if (firstAiMessage?.content) {
                const content =
                  typeof firstAiMessage.content === "string"
                    ? firstAiMessage.content
                    : firstAiMessage.content[0]?.text || "";
                description = content.slice(0, 100);
              }
            }
          } catch {
            title = `会话 ${thread.thread_id.slice(0, 8)}`;
          }

          return {
            id: thread.thread_id,
            updatedAt: new Date(thread.updated_at),
            status: thread.status,
            title,
            description,
            assistantId,
            metadata,
            archived: metadata.internagents_archived === true,
          };
        })
        .filter((thread) => !thread.archived);
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
    }
  );
}
