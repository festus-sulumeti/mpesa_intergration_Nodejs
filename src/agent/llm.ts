import { toolDefinitions } from "./tools";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type LlmComplete = (messages: ChatMessage[]) => Promise<ChatMessage>;

export function openAiComplete(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): LlmComplete {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model ?? "gpt-4o-mini";

  return async (messages) => {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools: toolDefinitions.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`The agent model returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: ChatMessage }>;
    };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("The agent model returned an empty response");
    return message;
  };
}

export const AGENT_SYSTEM_PROMPT = [
  "You are a Lipa na M-Pesa cashier for Kenyan developers.",
  "Use only the provided tools.",
  "Never ask for or repeat consumer keys, secrets, passkeys, or access tokens.",
  "Amounts are whole Kenyan shillings.",
  "Call stk_push only when the latest user instruction says the person has confirmed.",
  "When you call stk_push, pass confirm=true.",
  "Explain result codes in English and Kiswahili.",
].join(" ");
