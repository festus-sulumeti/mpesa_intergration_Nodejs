import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../src/http/app";
import { handleMcpMessage } from "../src/mcp/protocol";
import { testContext } from "./helpers";

describe("reference server", () => {
  const { ctx, calls } = testContext();
  const app = createApp(ctx);
  let server: Server;
  let base: string;

  before(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
  });

  it("describes the service without credentials", async () => {
    const response = await request("/");
    assert.equal(response.status, 200);
    assert.equal(response.body.env, "sandbox");
    assert.equal(JSON.stringify(response.body).includes("consumer-secret"), false);
    assert.equal(JSON.stringify(response.body).includes("consumer-key"), false);
  });

  it("holds an STK push until it is confirmed", async () => {
    const response = await request("/stk", {
      method: "POST",
      body: { phone: "0712345678", amount: 500, accountReference: "MPESA", transactionDesc: "STK push" },
    });
    assert.equal(response.status, 409);
    assert.equal(calls.length, 0);
  });

  it("sends a confirmed push and applies the callback", async () => {
    const response = await request("/stk", {
      method: "POST",
      body: {
        phone: "+254712345678",
        amount: 500,
        accountReference: "MPESA",
        transactionDesc: "STK push",
        confirm: true,
        idempotencyKey: "http-1",
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.phone, "254712345678");

    const callback = await request("/callback", {
      method: "POST",
      body: {
        Body: {
          stkCallback: {
            MerchantRequestID: "merchant-1",
            CheckoutRequestID: "ws_CO_1",
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: 500 },
                { Name: "MpesaReceiptNumber", Value: "RCPT1" },
                { Name: "PhoneNumber", Value: 254712345678 },
              ],
            },
          },
        },
      },
    });
    assert.equal(callback.body.status, "success");

    const listed = await request("/transactions");
    assert.equal(listed.body.transactions[0].receipt, "RCPT1");
    assert.equal(listed.body.transactions[0].status, "success");
  });

  it("answers the Swahili agent in both languages without sending money", async () => {
    const beforeCalls = calls.length;
    const response = await request("/agent", {
      method: "POST",
      body: { message: "Nitumie stk ya mia tano kwa 0712345678" },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.needsConfirmation, true);
    assert.match(response.body.message.sw, /Thibitisha/);
    assert.equal(calls.length, beforeCalls);
  });

  async function request(path: string, options?: { method?: string; body?: unknown }) {
    const response = await fetch(`${base}${path}`, {
      method: options?.method ?? "GET",
      headers: options?.body ? { "content-type": "application/json" } : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
});

describe("MCP tools", () => {
  it("lists the cashier tools and blocks an unconfirmed push", async () => {
    const { ctx, calls } = testContext();
    const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx);
    const names = ((listed?.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    assert.deepEqual(names, ["normalize_phone", "stk_push", "query_stk", "explain_result", "list_transactions"]);

    const blocked = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "stk_push",
        arguments: {
          phone: "0712345678",
          amount: 500,
          accountReference: "MPESA",
          transactionDesc: "STK push",
          confirm: false,
        },
      },
    }, ctx);
    assert.equal((blocked?.result as { isError: boolean }).isError, true);
    assert.equal(calls.length, 0);

    const explained = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "explain_result", arguments: { resultCode: 1032 } },
    }, ctx);
    assert.match(JSON.stringify(explained?.result), /Mteja ameghairi ombi/);
  });
});
