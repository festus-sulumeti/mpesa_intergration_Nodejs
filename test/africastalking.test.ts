import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { createSmsClient, receiptMessage, type SmsPost } from "../src/africastalking/sms";
import { ussdStep } from "../src/africastalking/ussd";
import { createApp } from "../src/http/app";
import type { Transaction } from "../src/store/transactions";
import { testContext } from "./helpers";

describe("Africa's Talking SMS", () => {
  it("posts the receipt and keeps the API key out of the message", async () => {
    const sent: Array<{ url: string; body: string; apiKey: string }> = [];
    const post: SmsPost = async (input) => {
      sent.push(input);
      return { SMSMessageData: { Recipients: [{ statusCode: 101, status: "Success" }] } };
    };
    const sms = createSmsClient(
      { username: "sandbox", apiKey: "at-secret", env: "sandbox" },
      post
    );
    await sms.sendSms("0712345678", "Confirmed. KES 500. Receipt RCPT1.");
    assert.equal(sent[0]?.url, "https://api.sandbox.africastalking.com/version1/messaging");
    assert.match(sent[0]?.body ?? "", /username=sandbox/);
    assert.match(sent[0]?.body ?? "", /to=%2B254712345678/);
    assert.equal(sent[0]?.apiKey, "at-secret");
    assert.equal(sent[0]?.body.includes("at-secret"), false);
  });

  it("builds the receipt text", () => {
    assert.equal(
      receiptMessage({ amount: 500, receipt: "RCPT1" } as Transaction),
      "Confirmed. KES 500. Receipt RCPT1."
    );
  });
});

describe("USSD session", () => {
  it("asks for the amount, then describes the STK prompt", () => {
    const asking = ussdStep({ sessionId: "s1", phoneNumber: "+254712345678", text: "" }, 10_000);
    assert.equal(asking.type, "continue");
    const paying = ussdStep({ sessionId: "s1", phoneNumber: "+254712345678", text: "500" }, 10_000);
    assert.equal(paying.type, "pay");
    if (paying.type === "pay") assert.equal(paying.amount, 500);
    const rejected = ussdStep({ sessionId: "s1", phoneNumber: "+254712345678", text: "10.5" }, 10_000);
    assert.equal(rejected.type, "end");
  });

  it("sends one STK push from the handset and one SMS when the callback succeeds", async () => {
    const { ctx, calls } = testContext();
    const texts: string[] = [];
    const app = createApp(ctx, {
      apiKey: "test-key",
      sms: {
        async sendSms(_to, message) {
          texts.push(message);
        },
      },
    });
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const menu = await fetch(`${base}/ussd`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sessionId: "s1", phoneNumber: "+254712345678", text: "" }),
      });
      assert.match(await menu.text(), /^CON Enter amount/);
      assert.equal(calls.some((call) => call.url.includes("processrequest")), false);

      const pay = await fetch(`${base}/ussd`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sessionId: "s1", phoneNumber: "+254712345678", text: "500" }),
      });
      assert.match(await pay.text(), /^END STK prompt sent/);
      assert.equal(calls.filter((call) => call.url.includes("processrequest")).length, 1);

      const callback = await fetch(`${base}/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: "merchant-1",
              CheckoutRequestID: "ws_CO_1",
              ResultCode: 0,
              ResultDesc: "paid",
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: 500 },
                  { Name: "MpesaReceiptNumber", Value: "RCPT1" },
                ],
              },
            },
          },
        }),
      });
      assert.equal((await callback.json()).status, "success");
      assert.deepEqual(texts, ["Confirmed. KES 500. Receipt RCPT1."]);

      await fetch(`${base}/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: "merchant-1",
              CheckoutRequestID: "ws_CO_1",
              ResultCode: 0,
              ResultDesc: "paid",
              CallbackMetadata: { Item: [{ Name: "MpesaReceiptNumber", Value: "RCPT1" }] },
            },
          },
        }),
      });
      assert.equal(texts.length, 1);
    } finally {
      server.close();
    }
  });
});
