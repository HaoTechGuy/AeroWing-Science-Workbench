import useSWRInfinite from "swr/infinite";
import { useMemo } from "react";
import { Client, type Thread } from "@langchain/langgraph-sdk";
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

function messagesFromValues(values: unknown): any[] {
  if (!values || typeof values !== "object") {
    return [];
  }
  const messages = (values as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "string") {
        return block;
      }
      if (
        block &&
        typeof block === "object" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
    }
  }
  return "";
}

async function resolveThreadValues(
  thread: Thread,
  runtimeClient: Client | null
): Promise<unknown> {
  if (messagesFromValues(thread.values).length > 0 || !runtimeClient) {
    return thread.values;
  }

  try {
    const runtimeThread = await runtimeClient.threads.get(thread.thread_id);
    if (messagesFromValues(runtimeThread.values).length > 0) {
      return runtimeThread.values;
    }
  } catch {
    // Main service history remains the source of truth when runtime is absent.
  }

  try {
    const history = await runtimeClient.threads.getHistory(thread.thread_id, {
      limit: 80,
    });
    const stateWithMessages = history.find(
      (state) => messagesFromValues(state.values).length > 0
    );
    if (stateWithMessages) {
      return stateWithMessages.values;
    }
  } catch {
    // Keep the original thread record if runtime history cannot be read.
  }

  return thread.values;
}

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
  resourceId?: string;
  runtimeUrl?: string;
  assistantId?: string;
  workspaceId?: string;
  archived?: boolean;
}) {
  const remoteAgent = useRemoteAgent();
  const runtimeClient = useMemo(
    () =>
      props.runtimeUrl
        ? new Client({
            apiUrl: props.runtimeUrl,
            defaultHeaders: { "Content-Type": "application/json" },
          })
        : null,
    [props.runtimeUrl]
  );
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;
  const archived = props.archived ?? false;

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
        assistantId: props.assistantId || remoteAgent.graphName,
        status: props?.status,
        resourceId: props.resourceId,
        runtimeUrl: props.runtimeUrl,
        workspaceId: props.workspaceId,
        archived,
      };
    },
    async ({
      assistantId,
      status,
      resourceId,
      workspaceId,
      pageIndex,
      pageSize,
      archived,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      status?: Thread["status"];
      resourceId?: string;
      runtimeUrl?: string;
      workspaceId?: string;
      archived: boolean;
    }) => {
      const threads = await remoteAgent.searchThreads({
        limit: pageSize,
        offset: pageIndex * pageSize,
        status,
        metadata: {
          ...(resourceId ? { resource_id: resourceId } : {}),
          ...(workspaceId ? { internagents_workspace_id: workspaceId } : {}),
          ...(archived ? { internagents_archived: true } : {}),
        },
      });

      const resolvedThreads = await Promise.all(
        threads.map(async (thread) => ({
          thread,
          values: await resolveThreadValues(thread, runtimeClient),
        }))
      );

      return resolvedThreads
        .map(({ thread, values }): ThreadItem => {
          let title = "Untitled Thread";
          let description = "";
          const metadata =
            thread.metadata && typeof thread.metadata === "object"
              ? (thread.metadata as Record<string, unknown>)
              : {};

          try {
            const valuesRecord =
              values && typeof values === "object" ? (values as any) : null;
            const goal = valuesRecord?.goal;
            if (
              goal &&
              typeof goal === "object" &&
              typeof goal.objective === "string" &&
              goal.objective.trim()
            ) {
              const objective = goal.objective.trim();
              title =
                objective.slice(0, 50) + (objective.length > 50 ? "..." : "");
              description = `Goal ${goal.status || "active"}`;
            } else {
              const messages = messagesFromValues(values);
              if (messages.length > 0) {
                const firstHumanMessage = messages.find(
                  (m: any) => m?.type === "human"
                );
                if (firstHumanMessage?.content) {
                  const content = contentToText(firstHumanMessage.content);
                  title =
                    content.slice(0, 50) + (content.length > 50 ? "..." : "");
                }
                const firstAiMessage = messages.find(
                  (m: any) => m?.type === "ai"
                );
                if (firstAiMessage?.content) {
                  const content = contentToText(firstAiMessage.content);
                  description = content.slice(0, 100);
                }
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
        .filter((thread) => (archived ? thread.archived : !thread.archived));
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
    }
  );
}
