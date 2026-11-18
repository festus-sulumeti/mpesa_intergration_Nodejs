import { DarajaError } from "./errors";

export interface C2BNotification {
  transId: string;
  amount: number;
  billRef: string;
  msisdn: string;
  businessShortCode: string;
  firstName: string;
  transTime: string;
}

export function parseC2B(body: unknown): C2BNotification {
  if (!body || typeof body !== "object") {
    throw new DarajaError("C2B body is missing", "c2b");
  }
  const record = body as Record<string, unknown>;
  const transId = text(record.TransID);
  const msisdn = text(record.MSISDN);
  const amount = Number(record.TransAmount);
  if (!transId || !msisdn || !Number.isFinite(amount)) {
    throw new DarajaError("C2B notification is missing TransID, MSISDN, or TransAmount", "c2b");
  }
  return {
    transId,
    amount: Math.round(amount),
    billRef: text(record.BillRefNumber) || "C2B",
    msisdn,
    businessShortCode: text(record.BusinessShortCode),
    firstName: text(record.FirstName),
    transTime: text(record.TransTime),
  };
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
