export interface CommandResult {
  resultCode?: number;
  resultDesc: string;
  conversationId?: string;
  originatorConversationId?: string;
  receipt?: string;
}

export function parseCommandResult(body: unknown): CommandResult {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const result =
    root.Result && typeof root.Result === "object"
      ? (root.Result as Record<string, unknown>)
      : root;
  const resultCode =
    result.ResultCode == null || result.ResultCode === "" ? undefined : Number(result.ResultCode);
  return {
    resultCode: resultCode !== undefined && Number.isInteger(resultCode) ? resultCode : undefined,
    resultDesc: text(result.ResultDesc) || "Daraja queue timed out",
    conversationId: text(result.ConversationID) || undefined,
    originatorConversationId: text(result.OriginatorConversationID) || undefined,
    receipt: text(result.TransactionID) || parameter(result, "TransactionReceipt") || undefined,
  };
}

function parameter(result: Record<string, unknown>, key: string): string {
  const parameters = result.ResultParameters as { ResultParameter?: Array<{ Key?: string; Value?: unknown }> } | undefined;
  const items = Array.isArray(parameters?.ResultParameter) ? parameters.ResultParameter : [];
  const found = items.find((item) => item.Key === key);
  return text(found?.Value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
