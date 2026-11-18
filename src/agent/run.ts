import { maskPhone, normalizeKenyanPhone } from "../daraja/phone";
import { explainResult } from "../daraja/result-codes";
import { DarajaError } from "../daraja/errors";
import { callTool, type ToolContext } from "./tools";
import { planMessage, type Plan, type PlanDefaults } from "./plan";
import { AGENT_SYSTEM_PROMPT, type ChatMessage, type LlmComplete } from "./llm";

export interface AgentInput extends PlanDefaults {
  message: string;
  confirm?: boolean;
  llm?: LlmComplete;
}

export interface AgentResult {
  plan: Plan;
  executed: Array<{ tool: string; data: Record<string, unknown> }>;
  needsConfirmation: boolean;
  message: { en: string; sw: string };
}

export async function runAgent(input: AgentInput, ctx?: ToolContext): Promise<AgentResult> {
  if (input.llm) return runWithModel(input, input.llm, ctx);
  return runLocal(input, ctx);
}

async function runLocal(input: AgentInput, ctx?: ToolContext): Promise<AgentResult> {
  const plan = planMessage(input.message, input);
  if (plan.intent === "unknown") {
    return { plan, executed: [], needsConfirmation: false, message: plan.message ?? askForDetails() };
  }

  if (plan.intent === "explain") {
    const code = Number(plan.steps[0]?.args.resultCode);
    const explained = explainResult(code);
    return {
      plan,
      executed: [{ tool: "explain_result", data: { ...explained } }],
      needsConfirmation: false,
      message: { en: explained.en, sw: explained.sw },
    };
  }

  if (plan.intent === "stk") {
    const push = plan.steps.find((step) => step.tool === "stk_push");
    const phone = normalizeKenyanPhone(String(push?.args.phone ?? ""));
    const amount = Number(push?.args.amount);
    const accountReference = String(push?.args.accountReference ?? "");
    if (input.confirm !== true) {
      return {
        plan,
        executed: [{ tool: "normalize_phone", data: { phone } }],
        needsConfirmation: true,
        message: confirmationCopy(amount, phone, accountReference),
      };
    }
    if (!ctx) throw new DarajaError("A Daraja client is required to send the STK push", "config", 500);
    const data = await callTool(
      "stk_push",
      { ...push?.args, phone, confirm: true },
      ctx
    );
    return {
      plan,
      executed: [data],
      needsConfirmation: false,
      message: data.data.replayed
        ? {
            en: "This payment was already submitted and was not sent again.",
            sw: "Malipo haya yalishatumwa na hayajatumiwa tena.",
          }
        : {
            en: "The STK prompt was sent. Wait for the customer to enter their PIN.",
            sw: "Ombi la STK limetumwa. Subiri mteja aweke PIN.",
          },
    };
  }

  if (plan.intent === "reversal") {
    const receipt = String(plan.steps[0]?.args.receipt ?? "");
    if (input.confirm !== true) {
      return {
        plan,
        executed: [],
        needsConfirmation: true,
        message: {
          en: `Confirm reversal of ${receipt}. Call again with confirm=true.`,
          sw: `Thibitisha kurudisha muamala ${receipt}. Tuma tena na confirm=true.`,
        },
      };
    }
    if (!ctx) throw new DarajaError("A Daraja client is required to reverse a payment", "config", 500);
    const data = await callTool("reversal", { ...plan.steps[0]?.args, confirm: true }, ctx);
    return {
      plan,
      executed: [data],
      needsConfirmation: false,
      message: data.data.replayed
        ? {
            en: "This receipt was already reversed and was not sent again.",
            sw: "Risiti hii ilisharudishwa na haijatumwa tena.",
          }
        : {
            en: "The reversal was submitted.",
            sw: "Ombi la kurudisha malipo limetumwa.",
          },
    };
  }

  if (!ctx) throw new DarajaError("A Daraja client is required for this request", "config", 500);
  const executed = [];
  for (const step of plan.steps) {
    executed.push(await callTool(step.tool, step.args, ctx));
  }
  return {
    plan,
    executed,
    needsConfirmation: false,
    message: {
      en: "Done.",
      sw: "Imekamilika.",
    },
  };
}

async function runWithModel(
  input: AgentInput,
  complete: LlmComplete,
  ctx?: ToolContext
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: input.confirm
        ? `${input.message}\n\nThe person has confirmed this payment.`
        : `${input.message}\n\nThe person has not confirmed a payment. Do not call stk_push.`,
    },
  ];
  const executed: AgentResult["executed"] = [];

  for (let turn = 0; turn < 3; turn += 1) {
    const reply = await complete(messages);
    messages.push(reply);
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      return {
        plan: { intent: "unknown", steps: [] },
        executed,
        needsConfirmation: false,
        message: { en: reply.content ?? "Done.", sw: reply.content ?? "Imekamilika." },
      };
    }
    if (!ctx) throw new DarajaError("A Daraja client is required to run model tools", "config", 500);
    for (const call of calls) {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      if (call.function.name === "stk_push") args.confirm = input.confirm === true;
      try {
        const result = await callTool(call.function.name, args, ctx);
        executed.push(result);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result.data),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool failed";
        executed.push({ tool: call.function.name, data: { error: message } });
        messages.push({ role: "tool", tool_call_id: call.id, content: message });
      }
    }
  }

  return {
    plan: { intent: "unknown", steps: [] },
    executed,
    needsConfirmation: input.confirm !== true && executed.some((item) => item.tool === "normalize_phone"),
    message: {
      en: "The agent stopped after three tool rounds.",
      sw: "Wakala amesimama baada ya hatua tatu.",
    },
  };
}

function confirmationCopy(amount: number, phone: string, accountReference: string): { en: string; sw: string } {
  const masked = maskPhone(phone);
  return {
    en: `Confirm KES ${amount} to ${masked} for ${accountReference}. Call again with confirm=true.`,
    sw: `Thibitisha malipo ya KES ${amount} kwenda ${masked} kwa ${accountReference}. Tuma tena na confirm=true.`,
  };
}

function askForDetails(): { en: string; sw: string } {
  return {
    en: "Include a Kenyan phone and an amount in whole shillings.",
    sw: "Weka nambari ya simu na kiasi cha shilingi kamili.",
  };
}
