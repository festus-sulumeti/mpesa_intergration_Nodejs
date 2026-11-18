import axios from "axios";
import { DarajaError } from "../daraja/errors";
import { normalizeKenyanPhone } from "../daraja/phone";
import type { Transaction } from "../store/transactions";

export interface AtConfig {
  username: string;
  apiKey: string;
  env: "sandbox" | "production";
  senderId?: string;
}

export interface SmsClient {
  sendSms(to: string, message: string): Promise<void>;
}

export function loadAtConfig(env: NodeJS.ProcessEnv = process.env): AtConfig | undefined {
  if (!env.AT_USERNAME || !env.AT_API_KEY) return undefined;
  const mode = (env.AT_ENV ?? "sandbox").toLowerCase();
  if (mode !== "sandbox" && mode !== "production") {
    throw new DarajaError("AT_ENV must be sandbox or production", "config", 500);
  }
  return {
    username: env.AT_USERNAME,
    apiKey: env.AT_API_KEY,
    env: mode,
    senderId: env.AT_SENDER_ID,
  };
}

export function smsUrl(env: AtConfig["env"]): string {
  return env === "production"
    ? "https://api.africastalking.com/version1/messaging"
    : "https://api.sandbox.africastalking.com/version1/messaging";
}

export type SmsPost = (input: { url: string; body: string; apiKey: string }) => Promise<unknown>;

export function createSmsClient(config: AtConfig, post: SmsPost = postWithAxios): SmsClient {
  return {
    async sendSms(to, message) {
      const body = new URLSearchParams({
        username: config.username,
        to: atPhone(to),
        message,
      });
      if (config.senderId) body.set("from", config.senderId);
      try {
        const data = await post({ url: smsUrl(config.env), body: body.toString(), apiKey: config.apiKey });
        const recipient = (data as { SMSMessageData?: { Recipients?: Array<{ statusCode?: number; status?: string }> } })
          ?.SMSMessageData?.Recipients?.[0];
        const statusCode = recipient?.statusCode;
        if (statusCode == null || statusCode > 102) {
          throw new DarajaError(recipient?.status || "Africa's Talking rejected the SMS", "sms", 502);
        }
      } catch (err) {
        if (err instanceof DarajaError) throw err;
        throw new DarajaError("Africa's Talking rejected the SMS", "sms", 502);
      }
    },
  };
}

async function postWithAxios(input: { url: string; body: string; apiKey: string }): Promise<unknown> {
  const response = await axios.post(input.url, input.body, {
    headers: {
      apiKey: input.apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  return response.data;
}

export function receiptMessage(tx: Transaction): string {
  if (tx.receipt) return `Confirmed. KES ${tx.amount}. Receipt ${tx.receipt}.`;
  return `Confirmed. KES ${tx.amount}.`;
}

export async function notifyPaid(sms: SmsClient | undefined, tx: Transaction): Promise<void> {
  if (!sms || !tx.phone) return;
  try {
    atPhone(tx.phone);
    await sms.sendSms(tx.phone, receiptMessage(tx));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "SMS failed");
  }
}

function atPhone(phone: string): string {
  return `+${normalizeKenyanPhone(phone)}`;
}
