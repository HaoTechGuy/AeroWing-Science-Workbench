#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const UPSTREAM = "https://docs.langchain.com/mcp";

async function callUpstream(method, params) {
  const response = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LangChain docs MCP returned ${response.status}: ${text}`);
  }

  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`Unexpected LangChain docs MCP response: ${text}`);
  }

  const message = JSON.parse(dataLine.slice("data: ".length));
  if (message.error) {
    throw new Error(JSON.stringify(message.error));
  }

  return message.result;
}

const server = new McpServer({
  name: "langchain-docs-proxy",
  version: "0.1.0",
});

server.registerTool(
  "search_docs_by_lang_chain",
  {
    description:
      "Search across the LangChain documentation for guides, examples, API references, and implementation details.",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => {
    return callUpstream("tools/call", {
      name: "search_docs_by_lang_chain",
      arguments: { query },
    });
  },
);

server.registerTool(
  "query_docs_filesystem_docs_by_lang_chain",
  {
    description:
      "Run a read-only shell-like query against the LangChain documentation filesystem. Supports commands like rg, tree, ls, cat, head, and sed.",
    inputSchema: {
      command: z
        .string()
        .describe(
          'Read-only docs filesystem command, for example: "tree / -L 2" or "head -80 /oss/python/deepagents/overview.mdx"',
        ),
    },
  },
  async ({ command }) => {
    return callUpstream("tools/call", {
      name: "query_docs_filesystem_docs_by_lang_chain",
      arguments: { command },
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
