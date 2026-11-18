import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { callTool } from "../src/agent/tools";
import { planMessage } from "../src/agent/plan";
import { createDarajaClient, type HttpClient } from "../src/daraja/client";
import type { DarajaConfig } from "../src/daraja/config";
import { DarajaError } from "../src/daraja/errors";
import { explainResult } from "../src/daraja/result-codes";
import { applyCommandResult, recordC2BConfirmation } from "../src/http/callbacks";
import { watchPendingStk } from "../src/http/watch";
import { createSqliteStore } from "../src/store/sqlite";
import { createMemoryStore, type Transaction } from "../src/store/transactions";
import { createFakeHttp, testConfig } from "./helpers";

const payoutConfig: DarajaConfig = {
  ...testConfig,
  initiatorName: "testapi",
  securityCredential: "encrypted-credential",
  c2bValidationUrl: "https://example.test/c2b/validation",
  c2bConfirmationUrl: "https://example.test/c2b/confirmation",
  b2cResultUrl: "https://example.test/b2c/result",
  b2cTimeoutUrl: "https://example.test/b2c/timeout",
  reversalResultUrl: "https://example.test/reversal/result",
  reversalTimeoutUrl: "https://example.test/reversal/timeout",
  balanceResultUrl: "https://example.test/balance/result",
  balanceTimeoutUrl: "https://example.test/balance/timeout",
};

describe("Daraja products", () => {
  it("keeps result code 4999 pending", () => {
    assert.equal(explainResult(4999).outcome, "pending");
    assert.equal(explainResult(4999).sw, "Muamala bado unaendelea");
  });

  it("sends one confirmed B2C payout and hides the security credential", async () => {
    const { ctx, calls } = payoutContext();
    await assert.rejects(
      callTool("b2c_payment", { phone: "0712345678", amount: 20, confirm: false }, ctx),
      DarajaError
    );
    assert.equal(calls.length, 0);

    const first = await callTool(
      "b2c_payment",
      { phone: "0712345678", amount: 20, confirm: true, idempotencyKey: "b2c-1" },
      ctx
    );
    const second = await callTool(
      "b2c_payment",
      { phone: "0712345678", amount: 20, confirm: true, idempotencyKey: "b2c-1" },
      ctx
    );
    const body = calls.find((call) => call.url.includes("paymentrequest"))?.body as Record<string, unknown>;
    assert.equal(body.PartyB, "254712345678");
    assert.equal(body.SecurityCredential, "encrypted-credential");
    assert.equal(JSON.stringify(first.data).includes("encrypted-credential"), false);
    assert.equal(second.data.replayed, true);
    assert.equal(calls.filter((call) => call.url.includes("paymentrequest")).length, 1);
  });

  it("reverses a receipt once and records a C2B confirmation once", async () => {
    const { ctx, calls } = payoutContext();
    const reversal = await callTool(
      "reversal",
      { receipt: "RCPT1", amount: 500, confirm: true },
      ctx
    );
    const again = await callTool(
      "reversal",
      { receipt: "RCPT1", amount: 500, confirm: true },
      ctx
    );
    const body = calls.find((call) => call.url.includes("reversal"))?.body as Record<string, unknown>;
    assert.equal(body.TransactionID, "RCPT1");
    assert.equal(body.RecieverIdentifierType, "11");
    assert.equal(again.data.replayed, true);
    assert.equal(JSON.stringify(reversal.data).includes("encrypted-credential"), false);

    const notice = {
      TransID: "C2B123",
      TransAmount: "10.00",
      BillRefNumber: "school fees",
      MSISDN: "254712345678",
      BusinessShortCode: "174379",
    };
    const stored = recordC2BConfirmation(ctx.store, notice);
    const duplicate = recordC2BConfirmation(ctx.store, notice);
    assert.equal(stored.transaction?.id, duplicate.transaction?.id);
    assert.equal(stored.becameSuccess, true);
    assert.equal(duplicate.becameSuccess, false);
    assert.equal(stored.transaction?.receipt, "C2B123");
    assert.equal(ctx.store.list().filter((tx) => tx.kind === "c2b").length, 1);
  });

  it("updates only a balance request this server created", async () => {
    const { ctx } = payoutContext();
    const accepted = await callTool("account_balance", {}, ctx);
    const transaction = accepted.data.transaction as { conversationId: string };
    const unknown = applyCommandResult(
      ctx.store,
      { Result: { ConversationID: "someone-else", ResultCode: 0, ResultDesc: "ok" } },
      false
    );
    assert.equal(unknown.transaction, undefined);
    assert.equal(unknown.becameSuccess, false);
    const updated = applyCommandResult(
      ctx.store,
      {
        Result: {
          ConversationID: transaction.conversationId,
          ResultCode: 0,
          ResultDesc: "Balance retrieved",
          TransactionID: "BAL1",
        },
      },
      false
    );
    assert.equal(updated.transaction?.status, "success");
    assert.equal(updated.transaction?.receipt, "BAL1");
    assert.equal(updated.becameSuccess, true);

    const timedOut = applyCommandResult(
      ctx.store,
      { Result: { ConversationID: "not-pending", ResultCode: 0 } },
      true
    );
    assert.equal(timedOut.transaction, undefined);
  });

  it("queries a pending STK push after the callback window", async () => {
    const pending = sample("ws_CO_wait");
    const store = createMemoryStore([pending]);
    const { http } = createFakeHttp({ resultCode: 0, resultDesc: "paid" });
    const ctx = { client: createDarajaClient(testConfig, http), store };
    watchPendingStk(ctx, "ws_CO_wait", 10);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(store.findByCheckout("ws_CO_wait")?.status, "success");
    assert.equal(store.findByCheckout("ws_CO_wait")?.resultCode, 0);
  });

  it("registers C2B urls only after confirmation", async () => {
    const { ctx, calls } = payoutContext();
    await assert.rejects(callTool("register_c2b", { confirm: false }, ctx), /confirm=true/);
    const registered = await callTool("register_c2b", { confirm: true }, ctx);
    const body = calls.find((call) => call.url.includes("registerurl"))?.body as Record<string, string>;
    assert.equal(body.ValidationURL, payoutConfig.c2bValidationUrl);
    assert.equal(body.ConfirmationURL, payoutConfig.c2bConfirmationUrl);
    assert.equal(registered.data.responseCode, "0");
    assert.equal(JSON.stringify(registered.data).includes("encrypted-credential"), false);
  });

  it("plans a reversal without sending it", () => {
    const plan = planMessage("rudisha NLJ7RT61SV");
    assert.equal(plan.intent, "reversal");
    assert.equal(plan.steps[0]?.args.receipt, "NLJ7RT61SV");
    assert.equal(plan.steps[0]?.args.confirm, false);
  });
});

describe("sqlite ledger", () => {
  it("keeps the receipt and masked phone after reopening the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "daraja-sqlite-"));
    const path = join(dir, "daraja.sqlite");
    const store = createSqliteStore(path);
    store.insert(sample("ws_CO_sql"));
    const saved = store.findByCheckout("ws_CO_sql");
    assert.ok(saved);
    store.save({ ...saved, receipt: "RCPT9", status: "success", resultCode: 0 });

    const reopened = createSqliteStore(path);
    const row = reopened.findByCheckout("ws_CO_sql");
    assert.equal(row?.receipt, "RCPT9");
    assert.equal(row?.phoneMasked, "2547******78");
    assert.equal(row?.idempotencyKey, "ledger-1");
  });
});

function payoutContext() {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const http: HttpClient = {
    async get(url) {
      calls.push({ url });
      return { data: { access_token: "token-1", expires_in: "3600" } };
    },
    async post(url, body) {
      calls.push({ url, body });
      if (url.includes("registerurl")) {
        return { data: { ResponseCode: "0", ResponseDescription: "success" } };
      }
      return {
        data: {
          ResponseCode: "0",
          ResponseDescription: "Accept the service request",
          ConversationID: "conv-1",
          OriginatorConversationID: "orig-1",
        },
      };
    },
  };
  return {
    calls,
    ctx: {
      client: createDarajaClient(payoutConfig, http),
      store: createMemoryStore(),
    },
  };
}

function sample(checkoutRequestId: string): Transaction {
  return {
    id: `id-${checkoutRequestId}`,
    idempotencyKey: "ledger-1",
    phone: "254712345678",
    amount: 1,
    accountReference: "SANDBOX",
    transactionDesc: "One shilling",
    checkoutRequestId,
    kind: "stk",
    status: "pending",
    createdAt: "2026-01-16T00:05:09.000Z",
  };
}
