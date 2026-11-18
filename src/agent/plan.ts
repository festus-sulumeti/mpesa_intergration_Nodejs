import { DarajaError } from "../daraja/errors";
import { toAccountReference, toTransactionDesc } from "../daraja/money";
import type { TransactionType } from "../daraja/client";

export type PlanIntent = "stk" | "query" | "explain" | "list" | "unknown";

export interface PlanStep {
  tool: "normalize_phone" | "stk_push" | "query_stk" | "explain_result" | "list_transactions";
  args: Record<string, unknown>;
}

export interface Plan {
  intent: PlanIntent;
  steps: PlanStep[];
  message?: { en: string; sw: string };
}

export interface PlanDefaults {
  accountReference?: string;
  transactionDesc?: string;
  idempotencyKey?: string;
  transactionType?: TransactionType;
  partyB?: string;
}

const SWAHILI_AMOUNTS: Array<[string, number]> = [
  ["elfu moja", 1000],
  ["mia tisa", 900],
  ["mia nane", 800],
  ["mia saba", 700],
  ["mia sita", 600],
  ["mia tano", 500],
  ["mia nne", 400],
  ["mia tatu", 300],
  ["mia mbili", 200],
  ["mia moja", 100],
];

export function planMessage(message: string, defaults: PlanDefaults = {}): Plan {
  const text = message.trim();
  const lower = text.toLowerCase();

  const code = /(?:result\s*code|msimbo|code)\s*(\d+)/i.exec(lower);
  if (code && /mean|maana|explain|nini|result|msimbo/.test(lower)) {
    return {
      intent: "explain",
      steps: [{ tool: "explain_result", args: { resultCode: Number(code[1]) } }],
    };
  }

  if (/\b(list transactions|show transactions|onyesha miamala)\b/i.test(lower)) {
    return { intent: "list", steps: [{ tool: "list_transactions", args: {} }] };
  }

  const checkout = /\b(ws_co_[a-z0-9_]+)\b/i.exec(text);
  if (checkout && /query|status|hali|angalia/.test(lower)) {
    return {
      intent: "query",
      steps: [{ tool: "query_stk", args: { checkoutRequestId: checkout[1] } }],
    };
  }

  const phoneMatch = text.match(/(?:\+?254|0)[17]\d{8}|\b[17]\d{8}\b/);
  if (!phoneMatch) return unknownPlan();

  const withoutPhone = text.replace(phoneMatch[0], " ");
  const amount = readAmount(withoutPhone.toLowerCase());
  if (amount === undefined) {
    return {
      intent: "unknown",
      steps: [],
      message: {
        en: "Include an amount in whole shillings, for example KES 500.",
        sw: "Weka kiasi cha shilingi kamili, kwa mfano KES 500.",
      },
    };
  }

  const purpose = lastPurpose(text);
  const referenceSource = defaults.accountReference ?? purpose ?? "MPESA";
  const descriptionSource = defaults.transactionDesc ?? purpose ?? "STK push";
  let accountReference: string;
  let transactionDesc: string;
  try {
    accountReference = toAccountReference(referenceSource, { truncate: true });
    transactionDesc = toTransactionDesc(descriptionSource, { truncate: true });
  } catch (err) {
    const messageText = err instanceof DarajaError ? err.message : "Could not read the payment details";
    return { intent: "unknown", steps: [], message: { en: messageText, sw: messageText } };
  }

  return {
    intent: "stk",
    steps: [
      { tool: "normalize_phone", args: { phone: phoneMatch[0] } },
      {
        tool: "stk_push",
        args: {
          phone: phoneMatch[0],
          amount,
          accountReference,
          transactionDesc,
          confirm: false,
          idempotencyKey: defaults.idempotencyKey,
          transactionType: defaults.transactionType,
          partyB: defaults.partyB,
        },
      },
    ],
  };
}

function lastPurpose(text: string): string | undefined {
  const parts = text.split(/\bfor\s+/i);
  if (parts.length < 2) return undefined;
  const purpose = parts[parts.length - 1]?.trim();
  return purpose || undefined;
}

function readAmount(text: string): number | undefined {
  for (const [phrase, value] of SWAHILI_AMOUNTS) {
    if (text.includes(phrase)) return value;
  }
  const labelled = /(?:kes|ksh|kshs)\s*(\d+)/i.exec(text);
  if (labelled) return Number(labelled[1]);
  const bare = /\b(\d{1,7})\b/.exec(text);
  return bare ? Number(bare[1]) : undefined;
}

function unknownPlan(): Plan {
  return {
    intent: "unknown",
    steps: [],
    message: {
      en: "Include a Kenyan phone and an amount in whole shillings. Example: Send KES 500 to 0712345678 for January chama.",
      sw: "Weka nambari ya simu na kiasi cha shilingi kamili. Mfano: Tuma KES 500 kwa 0712345678 kwa January chama.",
    },
  };
}
