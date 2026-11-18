import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseCallback } from "../src/daraja/callback";
import { createDarajaClient } from "../src/daraja/client";
import { loadConfig } from "../src/daraja/config";
import { DarajaError } from "../src/daraja/errors";
import { parseAmount } from "../src/daraja/money";
import { maskPhone, normalizeKenyanPhone } from "../src/daraja/phone";
import { explainResult } from "../src/daraja/result-codes";
import { darajaTimestamp, stkPassword } from "../src/daraja/time";
import { callTool } from "../src/agent/tools";
import { createFileStore } from "../src/store/transactions";
import { createFakeHttp, testConfig, testContext } from "./helpers";

describe("Kenyan phone numbers", () => {
  it("normalizes 07, 01, 254, and +254 forms", () => {
    assert.equal(normalizeKenyanPhone("0712345678"), "254712345678");
    assert.equal(normalizeKenyanPhone("0112345678"), "254112345678");
    assert.equal(normalizeKenyanPhone("254712345678"), "254712345678");
    assert.equal(normalizeKenyanPhone("+254712345678"), "254712345678");
    assert.equal(normalizeKenyanPhone("712345678"), "254712345678");
    assert.equal(normalizeKenyanPhone("0712 345 678"), "254712345678");
  });

  it("rejects the old 2540 prefix bug", () => {
    assert.throws(() => normalizeKenyanPhone("2540712345678"), DarajaError);
    assert.throws(() => normalizeKenyanPhone("+2540712345678"), DarajaError);
  });

  it("masks the subscriber number", () => {
    assert.equal(maskPhone("254712345678"), "2547******78");
  });
});

describe("Nairobi timestamps and money", () => {
  it("formats Daraja timestamps in Africa/Nairobi", () => {
    assert.equal(darajaTimestamp(new Date("2026-01-15T21:05:09.000Z")), "20260116000509");
  });

  it("builds the STK password from shortcode, passkey, and timestamp", () => {
    assert.equal(
      stkPassword("174379", "pass", "20260116000509"),
      Buffer.from("174379pass20260116000509").toString("base64")
    );
  });

  it("accepts only whole shillings inside the cap", () => {
    assert.equal(parseAmount("500", 10_000), 500);
    assert.throws(() => parseAmount(10.5, 10_000), /whole Kenyan shillings/);
    assert.throws(() => parseAmount(10_001, 10_000), /cap/);
  });
});

describe("Daraja client", () => {
  it("caches the OAuth token and sends a normalized STK payload", async () => {
    const { http, calls } = createFakeHttp();
    let current = new Date("2026-01-15T21:05:09.000Z");
    const client = createDarajaClient(testConfig, http, () => current);
    assert.equal(await client.getAccessToken(), "token-1");
    assert.equal(await client.getAccessToken(), "token-1");
    assert.equal(calls.filter((call) => call.url.includes("oauth")).length, 1);

    const accepted = await client.stkPush({
      phone: "0712345678",
      amount: 500,
      accountReference: "January chama",
      transactionDesc: "January chama",
    });
    const stk = calls.find((call) => call.url.endsWith("/processrequest"));
    const body = stk?.body as Record<string, unknown>;
    assert.equal(body.PartyA, "254712345678");
    assert.equal(body.PhoneNumber, "254712345678");
    assert.equal(body.Amount, 500);
    assert.equal(body.Timestamp, "20260116000509");
    assert.equal(body.AccountReference, "JANUARYCHAMA");
    assert.equal(body.CallBackURL, testConfig.callbackUrl);
    assert.equal(stk?.headers.Authorization, "Bearer token-1");
    assert.equal(JSON.stringify(accepted).includes("consumer-secret"), false);
    assert.equal(JSON.stringify(accepted).includes("token-1"), false);

    current = new Date(current.getTime() + 4_000_000);
    await client.getAccessToken();
    assert.equal(calls.filter((call) => call.url.includes("oauth")).length, 2);
  });

  it("reports missing configuration by name only", () => {
    assert.throws(() => loadConfig({}), /MPESA_CONSUMER_KEY/);
  });
});

describe("callbacks and ledger", () => {
  it("reads a successful callback", () => {
    const parsed = parseCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "merchant-1",
          CheckoutRequestID: "ws_CO_1",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 500 },
              { Name: "MpesaReceiptNumber", Value: "ABC123" },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    });
    assert.equal(parsed.receipt, "ABC123");
    assert.equal(parsed.amount, 500);
    assert.equal(parsed.phone, "254712345678");
  });

  it("explains common result codes in English and Kiswahili", () => {
    const cancelled = explainResult(1032);
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(cancelled.sw, "Mteja ameghairi ombi");
    assert.equal(explainResult(1037).en.includes("timed out"), true);
  });

  it("refuses an unconfirmed push, caps the amount, and replays the same key", async () => {
    const { ctx, calls } = testContext();
    await assert.rejects(
      callTool("stk_push", {
        phone: "0712345678",
        amount: 500,
        accountReference: "MPESA",
        transactionDesc: "STK push",
        confirm: false,
      }, ctx),
      /confirm=true/
    );
    assert.equal(calls.length, 0);

    await assert.rejects(
      callTool("stk_push", {
        phone: "0712345678",
        amount: 10_001,
        accountReference: "MPESA",
        transactionDesc: "STK push",
        confirm: true,
      }, ctx),
      /cap/
    );

    const first = await callTool("stk_push", pushArgs(), ctx);
    const second = await callTool("stk_push", pushArgs(), ctx);
    assert.equal(first.data.replayed, false);
    assert.equal(second.data.replayed, true);
    assert.equal(calls.filter((call) => String(call.url).includes("processrequest")).length, 1);
    assert.equal(JSON.stringify(second.data).includes("254712345678"), false);
    assert.match(JSON.stringify(second.data), /2547\*\*\*\*\*\*78/);
  });

  it("stores the ledger on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "daraja-"));
    const store = createFileStore(join(dir, "transactions.json"));
    store.insert({
      id: "tx-1",
      idempotencyKey: "key-1",
      phone: "254712345678",
      amount: 100,
      accountReference: "MPESA",
      transactionDesc: "STK push",
      status: "pending",
      createdAt: "2026-01-16T00:00:00.000Z",
    });
    const reloaded = createFileStore(join(dir, "transactions.json"));
    assert.equal(reloaded.findByIdempotency("key-1")?.amount, 100);
  });
});

function pushArgs(): Record<string, unknown> {
  return {
    phone: "0712345678",
    amount: 500,
    accountReference: "MPESA",
    transactionDesc: "STK push",
    confirm: true,
    idempotencyKey: "same-day",
  };
}
