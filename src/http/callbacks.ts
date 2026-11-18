import { parseC2B } from "../daraja/c2b";
import { parseCallback } from "../daraja/callback";
import { parseCommandResult } from "../daraja/result";
import { statusFromResult } from "../daraja/result-codes";
import { newTransactionId, type Transaction, type TransactionStore } from "../store/transactions";

export interface AppliedUpdate {
  transaction?: Transaction;
  becameSuccess: boolean;
}

export function applyStkCallback(store: TransactionStore, body: unknown): AppliedUpdate {
  const parsed = parseCallback(body);
  const existing = store.findByCheckout(parsed.checkoutRequestId);
  if (!existing) return { becameSuccess: false };
  const next = statusFromResult(parsed.resultCode);
  const updated: Transaction = {
    ...existing,
    merchantRequestId: parsed.merchantRequestId || existing.merchantRequestId,
    status: existing.status === "success" && next === "pending" ? existing.status : next,
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    receipt: parsed.receipt ?? existing.receipt,
  };
  store.save(updated);
  return { transaction: updated, becameSuccess: existing.status !== "success" && updated.status === "success" };
}

export function recordC2BConfirmation(store: TransactionStore, body: unknown): AppliedUpdate {
  const notice = parseC2B(body);
  const idempotencyKey = `c2b:${notice.transId}`;
  const existing = store.findByIdempotency(idempotencyKey);
  if (existing) return { transaction: existing, becameSuccess: false };
  const reference = notice.billRef.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "C2B";
  const created: Transaction = {
    id: newTransactionId(),
    idempotencyKey,
    phone: notice.msisdn,
    amount: notice.amount,
    accountReference: reference,
    transactionDesc: "C2B payment",
    kind: "c2b",
    receipt: notice.transId,
    status: "success",
    resultCode: 0,
    resultDesc: "C2B confirmation received",
    createdAt: new Date().toISOString(),
  };
  store.insert(created);
  return { transaction: created, becameSuccess: true };
}

export function applyCommandResult(
  store: TransactionStore,
  body: unknown,
  timeout: boolean
): AppliedUpdate {
  const parsed = parseCommandResult(body);
  const id = parsed.conversationId || parsed.originatorConversationId;
  if (!id) return { becameSuccess: false };
  const existing = store.findByConversation(id);
  if (!existing || existing.status !== "pending") {
    return { transaction: existing, becameSuccess: false };
  }
  const next = timeout
    ? "failed"
    : parsed.resultCode === undefined
      ? existing.status
      : statusFromResult(parsed.resultCode);
  const updated: Transaction = {
    ...existing,
    status: next,
    resultCode: parsed.resultCode,
    resultDesc: timeout ? "Daraja queue timed out" : parsed.resultDesc,
    receipt: parsed.receipt ?? existing.receipt,
  };
  store.save(updated);
  return { transaction: updated, becameSuccess: updated.status === "success" };
}
