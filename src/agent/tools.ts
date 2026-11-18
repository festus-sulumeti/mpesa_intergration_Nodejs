import type { DarajaClient, TransactionType } from "../daraja/client";
import { DarajaError } from "../daraja/errors";
import { parseAmount, toAccountReference, toTransactionDesc } from "../daraja/money";
import { maskPhone, normalizeKenyanPhone } from "../daraja/phone";
import { explainResult, statusFromResult } from "../daraja/result-codes";
import { nairobiDay } from "../daraja/time";
import {
  newTransactionId,
  type Transaction,
  type TransactionStore,
} from "../store/transactions";

export type PaidHandler = (tx: Transaction) => void | Promise<void>;

export interface ToolContext {
  client?: DarajaClient;
  store: TransactionStore;
  now?: () => Date;
  onStkAccepted?: (checkoutRequestId: string) => void;
  onPaid?: PaidHandler;
}

export interface ToolResult {
  tool: string;
  data: Record<string, unknown>;
}

const TRANSACTIONS = ["CustomerPayBillOnline", "CustomerBuyGoodsOnline"] as const;

export const toolDefinitions = [
  {
    name: "normalize_phone",
    description: "Normalize a Kenyan mobile number to the 254 form Daraja expects.",
    inputSchema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
      additionalProperties: false,
    },
  },
  {
    name: "stk_push",
    description:
      "Send a Lipa na M-Pesa STK push. Refuses the call unless confirm is true. Replays an existing idempotency key instead of charging twice.",
    inputSchema: {
      type: "object",
      properties: {
        phone: { type: "string" },
        amount: { type: "integer" },
        accountReference: { type: "string" },
        transactionDesc: { type: "string" },
        confirm: { type: "boolean" },
        idempotencyKey: { type: "string" },
        transactionType: { type: "string", enum: [...TRANSACTIONS] },
        partyB: { type: "string" },
      },
      required: ["phone", "amount", "accountReference", "transactionDesc", "confirm"],
      additionalProperties: false,
    },
  },
  {
    name: "query_stk",
    description: "Query Daraja for an STK checkout request and update the local ledger.",
    inputSchema: {
      type: "object",
      properties: { checkoutRequestId: { type: "string" } },
      required: ["checkoutRequestId"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_result",
    description: "Explain a Daraja result code in English and Kiswahili.",
    inputSchema: {
      type: "object",
      properties: { resultCode: { type: "integer" } },
      required: ["resultCode"],
      additionalProperties: false,
    },
  },
  {
    name: "list_transactions",
    description: "List ledger rows. Phone numbers are masked. Credentials are never included.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "register_c2b",
    description:
      "Register C2B validation and confirmation URLs. Requires confirm=true because it changes where paybill notifications are sent.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
        validationUrl: { type: "string" },
        confirmationUrl: { type: "string" },
      },
      required: ["confirm"],
      additionalProperties: false,
    },
  },
  {
    name: "b2c_payment",
    description: "Send a B2C payout. Requires confirm=true. Replays the same idempotency key.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
        phone: { type: "string" },
        amount: { type: "integer" },
        remarks: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["confirm", "phone", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "account_balance",
    description: "Ask Daraja for the shortcode balance. The result arrives later on the balance callback.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "reversal",
    description: "Reverse an M-Pesa receipt. Requires confirm=true and will not reverse the same receipt twice.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
        receipt: { type: "string" },
        amount: { type: "integer" },
        remarks: { type: "string" },
      },
      required: ["confirm", "receipt"],
      additionalProperties: false,
    },
  },
] as const;

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  options?: { revealPhone?: boolean }
): Promise<ToolResult> {
  switch (name) {
    case "normalize_phone":
      return {
        tool: name,
        data: { phone: normalizeKenyanPhone(stringArg(args.phone, "phone")) },
      };
    case "stk_push":
      return { tool: name, data: await push(args, ctx, options?.revealPhone === true) };
    case "query_stk":
      return {
        tool: name,
        data: await query(stringArg(args.checkoutRequestId, "checkoutRequestId"), ctx, options?.revealPhone === true),
      };
    case "explain_result":
      return { tool: name, data: { ...explainResult(numberArg(args.resultCode, "resultCode")) } };
    case "list_transactions":
      return {
        tool: name,
        data: {
          transactions: ctx.store.list().map((tx) => present(tx, options?.revealPhone === true)),
        },
      };
    case "register_c2b":
      return { tool: name, data: await registerC2b(args, ctx) };
    case "b2c_payment":
      return { tool: name, data: await payB2c(args, ctx, options?.revealPhone === true) };
    case "account_balance":
      return { tool: name, data: await requestBalance(ctx) };
    case "reversal":
      return { tool: name, data: await reverse(args, ctx) };
    default:
      throw new DarajaError(`Unknown tool ${name}`, "tool");
  }
}

export function defaultIdempotencyKey(
  phone: string,
  amount: number,
  accountReference: string,
  date: Date
): string {
  return `${phone}:${amount}:${accountReference}:${nairobiDay(date)}`;
}

async function push(
  args: Record<string, unknown>,
  ctx: ToolContext,
  revealPhone: boolean
): Promise<Record<string, unknown>> {
  if (args.confirm !== true) {
    throw new DarajaError(
      "STK push requires confirm=true from the person approving the payment",
      "confirmation_required",
      409
    );
  }

  const client = requireClient(ctx);
  const now = ctx.now ?? (() => new Date());
  const phone = normalizeKenyanPhone(stringArg(args.phone, "phone"));
  const amount = parseAmount(args.amount, client.settings.amountCap);
  const accountReference = toAccountReference(stringArg(args.accountReference, "accountReference"));
  const transactionDesc = toTransactionDesc(stringArg(args.transactionDesc, "transactionDesc"));
  const idempotencyKey =
    typeof args.idempotencyKey === "string" && args.idempotencyKey
      ? args.idempotencyKey
      : defaultIdempotencyKey(phone, amount, accountReference, now());
  const existing = ctx.store.findByIdempotency(idempotencyKey);
  if (existing) {
    return { replayed: true, transaction: present(existing, revealPhone) };
  }

  const transactionType = transactionTypeArg(args.transactionType);
  const pending: Transaction = {
    id: newTransactionId(),
    idempotencyKey,
    phone,
    amount,
    accountReference,
    transactionDesc,
    status: "pending",
    createdAt: now().toISOString(),
  };
  ctx.store.insert(pending);

  try {
    const accepted = await client.stkPush({
      phone: pending.phone,
      amount: pending.amount,
      accountReference: pending.accountReference,
      transactionDesc: pending.transactionDesc,
      transactionType,
      partyB: typeof args.partyB === "string" ? args.partyB : undefined,
    });
    const saved: Transaction = {
      ...pending,
      phone: accepted.phone,
      amount: accepted.amount,
      accountReference: accepted.accountReference,
      transactionDesc: accepted.transactionDesc,
      checkoutRequestId: accepted.checkoutRequestId,
      merchantRequestId: accepted.merchantRequestId,
      status: "pending",
    };
    ctx.store.save(saved);
    if (saved.checkoutRequestId) ctx.onStkAccepted?.(saved.checkoutRequestId);
    return {
      replayed: false,
      customerMessage: accepted.customerMessage,
      transaction: present(saved, revealPhone),
    };
  } catch (err) {
    ctx.store.save({
      ...pending,
      status: "failed",
      resultDesc: err instanceof Error ? err.message : "STK push failed",
    });
    throw err;
  }
}

async function query(
  checkoutRequestId: string,
  ctx: ToolContext,
  revealPhone: boolean
): Promise<Record<string, unknown>> {
  const result = await requireClient(ctx).stkQuery(checkoutRequestId);
  const existing = ctx.store.findByCheckout(checkoutRequestId);
  let transaction = existing;
  if (existing?.status === "pending" && result.resultCode !== undefined) {
    transaction = {
      ...existing,
      status: statusFromResult(result.resultCode),
      resultCode: result.resultCode,
      resultDesc: result.resultDesc,
    };
    ctx.store.save(transaction);
    if (transaction.status === "success") await ctx.onPaid?.(transaction);
  }
  return {
    resultCode: result.resultCode,
    resultDesc: result.resultDesc,
    explanation: result.resultCode === undefined ? undefined : explainResult(result.resultCode),
    transaction: transaction ? present(transaction, revealPhone) : undefined,
  };
}

function present(tx: Transaction, revealPhone: boolean): Record<string, unknown> {
  return {
    id: tx.id,
    phone: revealPhone ? tx.phone : maskPhone(tx.phone),
    amount: tx.amount,
    accountReference: tx.accountReference,
    transactionDesc: tx.transactionDesc,
    kind: tx.kind ?? "stk",
    checkoutRequestId: tx.checkoutRequestId ?? null,
    merchantRequestId: tx.merchantRequestId ?? null,
    conversationId: tx.conversationId ?? null,
    status: tx.status,
    resultCode: tx.resultCode ?? null,
    resultDesc: tx.resultDesc ?? null,
    receipt: tx.receipt ?? null,
    createdAt: tx.createdAt,
  };
}

async function registerC2b(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  requireConfirm(args.confirm, "C2B URL registration");
  const registered = await requireClient(ctx).registerC2bUrls({
    validationUrl: optionalString(args.validationUrl),
    confirmationUrl: optionalString(args.confirmationUrl),
  });
  return {
    responseCode: registered.responseCode,
    responseDescription: registered.responseDescription,
  };
}

async function payB2c(
  args: Record<string, unknown>,
  ctx: ToolContext,
  revealPhone: boolean
): Promise<Record<string, unknown>> {
  requireConfirm(args.confirm, "B2C payout");
  const client = requireClient(ctx);
  const now = ctx.now ?? (() => new Date());
  const phone = normalizeKenyanPhone(stringArg(args.phone, "phone"));
  const amount = parseAmount(args.amount, client.settings.amountCap);
  const idempotencyKey =
    typeof args.idempotencyKey === "string" && args.idempotencyKey
      ? args.idempotencyKey
      : `b2c:${defaultIdempotencyKey(phone, amount, "B2C", now())}`;
  const existing = ctx.store.findByIdempotency(idempotencyKey);
  if (existing) return { replayed: true, transaction: present(existing, revealPhone) };

  const pending: Transaction = {
    id: newTransactionId(),
    idempotencyKey,
    phone,
    amount,
    accountReference: "B2C",
    transactionDesc: optionalString(args.remarks) || "B2C payment",
    kind: "b2c",
    status: "pending",
    createdAt: now().toISOString(),
  };
  ctx.store.insert(pending);
  try {
    const accepted = await client.b2c({
      phone,
      amount,
      remarks: pending.transactionDesc,
    });
    const saved: Transaction = {
      ...pending,
      phone: accepted.phone,
      amount: accepted.amount,
      conversationId: accepted.conversationId,
      originatorConversationId: accepted.originatorConversationId,
    };
    ctx.store.save(saved);
    return { replayed: false, transaction: present(saved, revealPhone) };
  } catch (err) {
    ctx.store.save({
      ...pending,
      status: "failed",
      resultDesc: err instanceof Error ? err.message : "B2C failed",
    });
    throw err;
  }
}

async function requestBalance(ctx: ToolContext): Promise<Record<string, unknown>> {
  const client = requireClient(ctx);
  const now = ctx.now ?? (() => new Date());
  const accepted = await client.accountBalance();
  const tx: Transaction = {
    id: newTransactionId(),
    idempotencyKey: `balance:${accepted.conversationId}`,
    phone: "",
    amount: 0,
    accountReference: "BALANCE",
    transactionDesc: "Balance",
    kind: "balance",
    conversationId: accepted.conversationId,
    originatorConversationId: accepted.originatorConversationId,
    status: "pending",
    createdAt: now().toISOString(),
  };
  ctx.store.insert(tx);
  return { transaction: present(tx, false) };
}

async function reverse(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  requireConfirm(args.confirm, "Reversal");
  const client = requireClient(ctx);
  const receipt = stringArg(args.receipt, "receipt");
  const idempotencyKey = `reversal:${receipt}`;
  const existing = ctx.store.findByIdempotency(idempotencyKey);
  if (existing) return { replayed: true, transaction: present(existing, false) };

  const prior = ctx.store.list().find((tx) => tx.receipt === receipt);
  const amount =
    args.amount == null ? prior?.amount : parseAmount(args.amount, client.settings.amountCap);
  if (!amount) {
    throw new DarajaError(
      "Amount is required to reverse a receipt that is not in the ledger",
      "amount"
    );
  }
  const now = ctx.now ?? (() => new Date());
  const pending: Transaction = {
    id: newTransactionId(),
    idempotencyKey,
    phone: prior?.phone ?? "",
    amount,
    accountReference: "REVERSAL",
    transactionDesc: optionalString(args.remarks) || "Reversal",
    kind: "reversal",
    receipt,
    status: "pending",
    createdAt: now().toISOString(),
  };
  ctx.store.insert(pending);
  try {
    const accepted = await client.reversal({ receipt, amount, remarks: pending.transactionDesc });
    const saved: Transaction = {
      ...pending,
      conversationId: accepted.conversationId,
      originatorConversationId: accepted.originatorConversationId,
    };
    ctx.store.save(saved);
    return { replayed: false, transaction: present(saved, false) };
  } catch (err) {
    ctx.store.save({
      ...pending,
      status: "failed",
      resultDesc: err instanceof Error ? err.message : "Reversal failed",
    });
    throw err;
  }
}

function requireConfirm(value: unknown, action: string): void {
  if (value !== true) {
    throw new DarajaError(
      `${action} requires confirm=true from the person approving it`,
      "confirmation_required",
      409
    );
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireClient(ctx: ToolContext): DarajaClient {
  if (!ctx.client) {
    throw new DarajaError("Daraja credentials are required for this tool", "config", 500);
  }
  return ctx.client;
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DarajaError(`${name} is required`, "tool_args");
  }
  return value.trim();
}

function numberArg(value: unknown, name: string): number {
  const parsed = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new DarajaError(`${name} must be an integer`, "tool_args");
  }
  return parsed;
}

function transactionTypeArg(value: unknown): TransactionType | undefined {
  if (value == null) return undefined;
  if (value === "CustomerPayBillOnline" || value === "CustomerBuyGoodsOnline") return value;
  throw new DarajaError("transactionType is not supported", "tool_args");
}
