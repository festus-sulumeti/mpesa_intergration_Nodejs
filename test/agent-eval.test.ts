import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentEvals } from "../src/agent/evals";
import type { LlmComplete } from "../src/agent/llm";
import { runAgent } from "../src/agent/run";
import { testContext } from "./helpers";

describe("agent evals", () => {
  for (const item of agentEvals) {
    it(item.name, async () => {
      const { ctx, calls } = testContext();
      const result = await runAgent({ message: item.message, confirm: false }, ctx);
      assert.equal(calls.some((call) => call.url.includes("processrequest")), false);

      if (item.intent === "explain") {
        assert.equal(result.needsConfirmation, false);
        assert.equal(result.executed[0]?.data.code, item.resultCode);
        assert.equal(typeof result.message.sw, "string");
        return;
      }

      assert.equal(result.needsConfirmation, true);
      assert.equal(result.executed[0]?.data.phone, item.phone);
      assert.match(result.message.en, new RegExp(`KES ${item.amount}`));
      assert.match(result.message.sw, /Thibitisha/);
      assert.match(result.message.en, new RegExp(item.accountReference ?? ""));

      const confirmed = await runAgent({ message: item.message, confirm: true }, ctx);
      assert.equal(confirmed.needsConfirmation, false);
      assert.equal(calls.filter((call) => call.url.includes("processrequest")).length, 1);
      const body = calls.find((call) => call.url.includes("processrequest"))?.body as {
        PartyA: string;
        Amount: number;
        AccountReference: string;
      };
      assert.equal(body.PartyA, item.phone);
      assert.equal(body.Amount, item.amount);
      assert.equal(body.AccountReference, item.accountReference);
    });
  }

  it("does not let the model confirm a payment the person has not approved", async () => {
    const { ctx, calls } = testContext();
    const llm: LlmComplete = async (messages) => {
      if (messages.some((message) => message.role === "tool")) {
        return { role: "assistant", content: "Waiting for confirmation." };
      }
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "stk_push",
              arguments: JSON.stringify({
                phone: "0712345678",
                amount: 500,
                accountReference: "MPESA",
                transactionDesc: "STK push",
                confirm: true,
              }),
            },
          },
        ],
      };
    };

    const result = await runAgent({ message: "Send KES 500 to 0712345678", confirm: false, llm }, ctx);
    assert.equal(calls.some((call) => call.url.includes("processrequest")), false);
    assert.match(result.executed.map((item) => JSON.stringify(item)).join(" "), /confirm=true/);
  });
});
