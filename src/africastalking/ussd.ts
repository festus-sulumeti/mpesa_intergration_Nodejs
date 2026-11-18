import { DarajaError } from "../daraja/errors";

export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  text: string;
}

export type UssdStep =
  | { type: "continue"; message: string }
  | { type: "end"; message: string }
  | { type: "pay"; phone: string; amount: number; message: string };

const ASK = "Enter amount in KES\nWeka kiasi cha shilingi";
const SENT = "STK prompt sent. Enter your M-Pesa PIN.\nOmbi limetumwa. Weka PIN.";
const BAD_AMOUNT = "Amount must be whole shillings.\nKiasi kiwe shilingi kamili.";

export function readUssd(body: unknown): UssdRequest {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sessionId = text(record.sessionId);
  const phoneNumber = text(record.phoneNumber);
  if (!sessionId || !phoneNumber) {
    throw new DarajaError("USSD sessionId and phoneNumber are required", "ussd");
  }
  return { sessionId, phoneNumber, text: text(record.text) };
}

export function ussdStep(input: UssdRequest, amountCap: number): UssdStep {
  const raw = input.text.split("*").filter(Boolean).at(-1) ?? "";
  if (!raw) return { type: "continue", message: ASK };
  if (!/^\d+$/.test(raw)) return { type: "end", message: BAD_AMOUNT };
  const amount = Number(raw);
  if (amount < 1 || amount > amountCap) return { type: "end", message: BAD_AMOUNT };
  return { type: "pay", phone: input.phoneNumber, amount, message: SENT };
}

export function ussdResponse(step: UssdStep): string {
  if (step.type === "continue") return `CON ${step.message}`;
  return `END ${step.message}`;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
