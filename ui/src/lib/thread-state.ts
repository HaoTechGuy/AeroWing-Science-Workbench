import type { Message } from "@langchain/langgraph-sdk";

type ValuesRecord = Record<string, unknown>;

function valuesRecord(values: unknown): ValuesRecord {
  return values && typeof values === "object" ? (values as ValuesRecord) : {};
}

export function messagesFromValues(values: unknown): Message[] {
  const messages = valuesRecord(values).messages;
  return Array.isArray(messages) ? (messages as Message[]) : [];
}

export function stateHasMessages(
  state?: { values?: unknown } | null
): state is { values: unknown } {
  return messagesFromValues(state?.values).length > 0;
}

export function findStateWithMessages<T extends { values?: unknown }>(
  states: T[]
): T | undefined {
  return states.find((state) => stateHasMessages(state));
}

export function mergeValuesWithMessages<T extends ValuesRecord>(
  primaryValues: unknown,
  incomingValues: unknown,
  options: { preservePrimaryMessages?: boolean } = {}
): T {
  const primaryRecord = valuesRecord(primaryValues);
  const incomingRecord = valuesRecord(incomingValues);
  const primaryMessages = messagesFromValues(primaryRecord);
  const incomingMessages = messagesFromValues(incomingRecord);
  const messages =
    options.preservePrimaryMessages && primaryMessages.length > 0
      ? primaryMessages
      : incomingMessages.length > 0
      ? incomingMessages
      : primaryMessages;

  return {
    ...primaryRecord,
    ...incomingRecord,
    messages,
  } as unknown as T;
}

async function loadValues(
  loader: (() => Promise<unknown>) | undefined
): Promise<unknown | undefined> {
  if (!loader) return undefined;
  try {
    return await loader();
  } catch {
    return undefined;
  }
}

export async function resolveThreadListValues({
  threadValues,
  loadMainStateValues,
  loadPendingValues,
  loadRuntimeStateValues,
  loadRuntimeThreadValues,
  loadRuntimeHistoryValues,
}: {
  threadValues: unknown;
  loadMainStateValues?: () => Promise<unknown>;
  loadPendingValues?: () => Promise<unknown>;
  loadRuntimeStateValues?: () => Promise<unknown>;
  loadRuntimeThreadValues?: () => Promise<unknown>;
  loadRuntimeHistoryValues?: () => Promise<unknown[]>;
}): Promise<unknown> {
  const mainStateValues = await loadValues(loadMainStateValues);
  if (messagesFromValues(mainStateValues).length > 0) {
    return mainStateValues;
  }

  const pendingValues = await loadValues(loadPendingValues);
  if (pendingValues && typeof pendingValues === "object") {
    return pendingValues;
  }

  if (messagesFromValues(threadValues).length > 0) {
    return threadValues;
  }

  const runtimeStateValues = await loadValues(loadRuntimeStateValues);
  if (messagesFromValues(runtimeStateValues).length > 0) {
    return runtimeStateValues;
  }

  const runtimeThreadValues = await loadValues(loadRuntimeThreadValues);
  if (messagesFromValues(runtimeThreadValues).length > 0) {
    return runtimeThreadValues;
  }

  const runtimeHistoryValues = await loadRuntimeHistoryValues?.().catch(
    () => undefined
  );
  const runtimeHistoryState = runtimeHistoryValues?.find(
    (values) => messagesFromValues(values).length > 0
  );
  if (runtimeHistoryState) {
    return runtimeHistoryState;
  }

  return threadValues;
}
