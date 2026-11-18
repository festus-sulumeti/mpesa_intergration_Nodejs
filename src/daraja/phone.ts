import { DarajaError } from "./errors";

export function normalizeKenyanPhone(input: string): string {
  const compact = input.replace(/[\s-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) {
    throw new DarajaError(
      "Phone must contain only digits, spaces, or a leading +",
      "phone"
    );
  }

  let normalized = digits;
  if (digits.startsWith("0") && digits.length === 10) {
    normalized = `254${digits.slice(1)}`;
  } else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) {
    normalized = `254${digits}`;
  }

  if (!/^254(?:7\d{8}|1\d{8})$/.test(normalized)) {
    throw new DarajaError(
      "Use a Kenyan mobile number in 07, 01, 254, or +254 form",
      "phone"
    );
  }
  return normalized;
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return "******";
  return `${phone.slice(0, 4)}******${phone.slice(-2)}`;
}
