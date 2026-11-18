import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { maskPhone } from "../daraja/phone";
import {
  type Transaction,
  type TransactionKind,
  type TransactionStatus,
  type TransactionStore,
} from "./transactions";

interface SqlRow {
  id: string;
  idempotency_key: string;
  phone: string;
  phone_masked: string;
  amount: number;
  account_reference: string;
  transaction_desc: string;
  checkout_request_id: string | null;
  merchant_request_id: string | null;
  conversation_id: string | null;
  originator_conversation_id: string | null;
  receipt: string | null;
  status: TransactionStatus;
  result_code: number | null;
  result_desc: string | null;
  kind: TransactionKind;
  created_at: string;
}

export function createSqliteStore(filePath: string): TransactionStore {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      phone_masked TEXT NOT NULL,
      amount INTEGER NOT NULL,
      account_reference TEXT NOT NULL,
      transaction_desc TEXT NOT NULL,
      checkout_request_id TEXT,
      merchant_request_id TEXT,
      conversation_id TEXT,
      originator_conversation_id TEXT,
      receipt TEXT,
      status TEXT NOT NULL,
      result_code INTEGER,
      result_desc TEXT,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_checkout
      ON transactions(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS transactions_conversation
      ON transactions(conversation_id);
    CREATE INDEX IF NOT EXISTS transactions_originator
      ON transactions(originator_conversation_id);
  `);

  const insert = db.prepare(`
    INSERT INTO transactions (
      id, idempotency_key, phone, phone_masked, amount, account_reference, transaction_desc,
      checkout_request_id, merchant_request_id, conversation_id, originator_conversation_id,
      receipt, status, result_code, result_desc, kind, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  const update = db.prepare(`
    UPDATE transactions SET
      phone = ?, phone_masked = ?, amount = ?, account_reference = ?, transaction_desc = ?,
      checkout_request_id = ?, merchant_request_id = ?, conversation_id = ?,
      originator_conversation_id = ?, receipt = ?, status = ?, result_code = ?,
      result_desc = ?, kind = ?
    WHERE id = ?
  `);
  const byCheckout = db.prepare(
    "SELECT * FROM transactions WHERE checkout_request_id = ?"
  );
  const byIdempotency = db.prepare(
    "SELECT * FROM transactions WHERE idempotency_key = ?"
  );
  const byConversation = db.prepare(
    "SELECT * FROM transactions WHERE conversation_id = ? OR originator_conversation_id = ?"
  );
  const list = db.prepare("SELECT * FROM transactions ORDER BY created_at DESC");

  return {
    insert(tx) {
      const row = toRow(tx);
      insert.run(...rowValues(row));
    },
    findByCheckout(id) {
      return mapRow(byCheckout.get(id) as SqlRow | undefined);
    },
    findByConversation(id) {
      return mapRow(byConversation.get(id, id) as SqlRow | undefined);
    },
    findByIdempotency(key) {
      return mapRow(byIdempotency.get(key) as SqlRow | undefined);
    },
    save(tx) {
      const row = toRow(tx);
      update.run(
        row.phone,
        row.phone_masked,
        row.amount,
        row.account_reference,
        row.transaction_desc,
        row.checkout_request_id,
        row.merchant_request_id,
        row.conversation_id,
        row.originator_conversation_id,
        row.receipt,
        row.status,
        row.result_code,
        row.result_desc,
        row.kind,
        row.id
      );
    },
    list() {
      return (list.all() as unknown as SqlRow[]).map((row) => mapRow(row) as Transaction);
    },
  };
}

function toRow(tx: Transaction): SqlRow {
  const phoneMasked = tx.phoneMasked || maskStoredPhone(tx.phone);
  return {
    id: tx.id,
    idempotency_key: tx.idempotencyKey,
    phone: tx.phone,
    phone_masked: phoneMasked,
    amount: tx.amount,
    account_reference: tx.accountReference,
    transaction_desc: tx.transactionDesc,
    checkout_request_id: tx.checkoutRequestId ?? null,
    merchant_request_id: tx.merchantRequestId ?? null,
    conversation_id: tx.conversationId ?? null,
    originator_conversation_id: tx.originatorConversationId ?? null,
    receipt: tx.receipt ?? null,
    status: tx.status,
    result_code: tx.resultCode ?? null,
    result_desc: tx.resultDesc ?? null,
    kind: tx.kind ?? "stk",
    created_at: tx.createdAt,
  };
}

function rowValues(row: SqlRow): Array<string | number | null> {
  return [
    row.id,
    row.idempotency_key,
    row.phone,
    row.phone_masked,
    row.amount,
    row.account_reference,
    row.transaction_desc,
    row.checkout_request_id,
    row.merchant_request_id,
    row.conversation_id,
    row.originator_conversation_id,
    row.receipt,
    row.status,
    row.result_code,
    row.result_desc,
    row.kind,
    row.created_at,
  ];
}

function mapRow(row: SqlRow | undefined): Transaction | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    phone: row.phone,
    phoneMasked: row.phone_masked,
    amount: row.amount,
    accountReference: row.account_reference,
    transactionDesc: row.transaction_desc,
    checkoutRequestId: row.checkout_request_id ?? undefined,
    merchantRequestId: row.merchant_request_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    originatorConversationId: row.originator_conversation_id ?? undefined,
    receipt: row.receipt ?? undefined,
    status: row.status,
    resultCode: row.result_code ?? undefined,
    resultDesc: row.result_desc ?? undefined,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function maskStoredPhone(phone: string): string {
  if (phone.length < 6) return "******";
  return maskPhone(phone);
}
