"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { Client } from "@langchain/langgraph-sdk";
import { WebRemoteAgent } from "@/lib/remote-agent";

interface RemoteAgentContextValue {
  agent: WebRemoteAgent;
  client: Client;
}

const RemoteAgentContext = createContext<RemoteAgentContextValue | null>(null);

interface ClientProviderProps {
  children: ReactNode;
  deploymentUrl: string;
  assistantId: string;
  apiKey: string;
}

export function RemoteAgentProvider({
  children,
  deploymentUrl,
  assistantId,
  apiKey,
}: ClientProviderProps) {
  const agent = useMemo(() => {
    return new WebRemoteAgent({
      url: deploymentUrl,
      graphName: assistantId,
      apiKey,
    });
  }, [deploymentUrl, assistantId, apiKey]);

  const value = useMemo(() => ({ agent, client: agent.client }), [agent]);

  return (
    <RemoteAgentContext.Provider value={value}>
      {children}
    </RemoteAgentContext.Provider>
  );
}

export const ClientProvider = RemoteAgentProvider;

export function useRemoteAgent(): WebRemoteAgent {
  const context = useContext(RemoteAgentContext);

  if (!context) {
    throw new Error("useRemoteAgent must be used within a RemoteAgentProvider");
  }
  return context.agent;
}

export function useClient(): Client {
  const context = useContext(RemoteAgentContext);

  if (!context) {
    throw new Error("useClient must be used within a RemoteAgentProvider");
  }
  return context.client;
}
