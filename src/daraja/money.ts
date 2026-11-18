import { DarajaError } from "./errors";

export function parseAmount(value: unknown, cap: number): number {
  const amount = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    throw new DarajaError("Amount must be whole Kenyan shillings", "amount");
  }
  if (amount < 1) {
    throw new DarajaError("Amount must be at least 1 shilling", "amount");
  }
  if (amount > cap) {
    throw new DarajaError(`Amount exceeds the cap of KES ${cap}`, "amount_cap");
  }
  return amount;
}

export function toAccountReference(value: string, options?: { truncate?: boolean }): string {
  const slug = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!slug) {
    throw new DarajaError("Account reference is required", "account_reference");
  }
  if (slug.length > 12) {
    if (options?.truncate) return slug.slice(0, 12);
    throw new DarajaError(
      "Account reference must be at most 12 letters or digits",
      "account_reference"
    );
  }
  return slug;
}

export function toTransactionDesc(value: string, options?: { truncate?: boolean }): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    throw new DarajaError("Transaction description is required", "transaction_desc");
  }
  if (clean.length > 13) {
    if (options?.truncate) return clean.slice(0, 13);
    throw new DarajaError(
      "Transaction description must be at most 13 characters",
      "transaction_desc"
    );
  }
  return clean;
}
