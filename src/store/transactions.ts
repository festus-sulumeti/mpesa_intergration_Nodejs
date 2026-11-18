import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type TransactionStatus = "pending" | "success" | "failed" | "cancelled";
export type TransactionKind = "stk" | "c2b" | "b2c" | "reversal" | "balance";

export interface Transaction {
  id: string;
  idempotencyKey: string;
  phone: string;
  phoneMasked?: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  conversationId?: string;
  originatorConversationId?: string;
  kind?: TransactionKind;
  status: TransactionStatus;
  resultCode?: number;
  resultDesc?: string;
  receipt?: string;
  createdAt: string;
}

export interface TransactionStore {
  insert(tx: Transaction): void;
  findByCheckout(id: string): Transaction | undefined;
  findByConversation(id: string): Transaction | undefined;
  findByIdempotency(key: string): Transaction | undefined;
  save(tx: Transaction): void;
  list(): Transaction[];
}

export function createMemoryStore(seed: Transaction[] = []): TransactionStore {
  const rows = [...seed];

  return {
    insert(tx) {
      rows.push(tx);
    },
    findByCheckout(id) {
      return rows.find((row) => row.checkoutRequestId === id);
    },
    findByConversation(id) {
      return rows.find(
        (row) => row.conversationId === id || row.originatorConversationId === id
      );
    },
    findByIdempotency(key) {
      return rows.find((row) => row.idempotencyKey === key);
    },
    save(tx) {
      const index = rows.findIndex((row) => row.id === tx.id);
      if (index === -1) rows.push(tx);
      else rows[index] = tx;
    },
    list() {
      return [...rows].reverse();
    },
  };
}

export function createFileStore(filePath: string): TransactionStore {
  const memory = createMemoryStore(readRows(filePath));
  const persist = () => writeRows(filePath, memory.list().slice().reverse());
  return {
    insert(tx) {
      memory.insert(tx);
      persist();
    },
    findByCheckout: (id) => memory.findByCheckout(id),
    findByConversation: (id) => memory.findByConversation(id),
    findByIdempotency: (key) => memory.findByIdempotency(key),
    save(tx) {
      memory.save(tx);
      persist();
    },
    list: () => memory.list(),
  };
}

export function newTransactionId(): string {
  return randomUUID();
}

function readRows(filePath: string): Transaction[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Transaction[]) : [];
  } catch {
    return [];
  }
}

function writeRows(filePath: string, rows: Transaction[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(rows, null, 2));
}
