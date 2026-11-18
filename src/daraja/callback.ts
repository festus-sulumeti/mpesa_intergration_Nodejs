import { DarajaError } from "./errors";

export interface ParsedCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount?: number;
  receipt?: string;
  phone?: string;
  transactionDate?: string;
}

interface CallbackItem {
  Name?: string;
  Value?: unknown;
}

export function parseCallback(body: unknown): ParsedCallback {
  if (!body || typeof body !== "object") {
    throw new DarajaError("Callback body is missing", "callback");
  }
  const stk = (body as { Body?: { stkCallback?: unknown } }).Body?.stkCallback;
  if (!stk || typeof stk !== "object") {
    throw new DarajaError("Callback is missing Body.stkCallback", "callback");
  }

  const record = stk as Record<string, unknown>;
  const resultCode = Number(record.ResultCode);
  if (!Number.isInteger(resultCode)) {
    throw new DarajaError("Callback ResultCode is missing", "callback");
  }
  const checkoutRequestId = stringValue(record.CheckoutRequestID);
  if (!checkoutRequestId) {
    throw new DarajaError("Callback CheckoutRequestID is missing", "callback");
  }

  const metadata = record.CallbackMetadata as { Item?: CallbackItem[] } | undefined;
  const items = Array.isArray(metadata?.Item) ? metadata.Item : [];
  const meta = new Map(items.map((item) => [item.Name, item.Value]));
  const amount = meta.get("Amount");

  return {
    merchantRequestId: stringValue(record.MerchantRequestID),
    checkoutRequestId,
    resultCode,
    resultDesc: stringValue(record.ResultDesc),
    amount: typeof amount === "number" ? amount : undefined,
    receipt: typeof meta.get("MpesaReceiptNumber") === "string"
      ? String(meta.get("MpesaReceiptNumber"))
      : undefined,
    phone: meta.get("PhoneNumber") == null ? undefined : String(meta.get("PhoneNumber")),
    transactionDate:
      meta.get("TransactionDate") == null ? undefined : String(meta.get("TransactionDate")),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
