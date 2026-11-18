import { callTool, toolDefinitions, type ToolContext } from "../agent/tools";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleMcpMessage(
  message: JsonRpcRequest,
  ctx: ToolContext
): Promise<JsonRpcResponse | null> {
  if (message.id == null || !message.method) return null;

  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "daraja", version: "1.0.0" },
      },
    };
  }

  if (message.method === "ping") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }

  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } };
  }

  if (message.method === "tools/call") {
    try {
      const result = await callTool(
        message.params?.name ?? "",
        message.params?.arguments ?? {},
        ctx
      );
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result.data) }],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: err instanceof Error ? err.message : "Tool failed" }],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" },
  };
}

export function startMcpServer(ctx: ToolContext): void {
  let buffer = Buffer.alloc(0);
  let reading = false;

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    void drain();
  });

  async function drain(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = Buffer.alloc(0);
          return;
        }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) return;
        const raw = buffer.subarray(start, start + length).toString("utf8");
        buffer = buffer.subarray(start + length);
        const response = await handleMcpMessage(JSON.parse(raw) as JsonRpcRequest, ctx);
        if (response) writeMessage(response);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : "MCP message failed");
    } finally {
      reading = false;
      if (buffer.includes("\r\n\r\n")) void drain();
    }
  }
}

export function writeMessage(message: unknown): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}
