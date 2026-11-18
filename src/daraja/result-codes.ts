export type PaymentOutcome = "success" | "cancelled" | "failed" | "pending" | "unknown";

export interface ResultExplanation {
  code: number;
  outcome: PaymentOutcome;
  en: string;
  sw: string;
}

const CODES: Record<number, Omit<ResultExplanation, "code">> = {
  0: {
    outcome: "success",
    en: "Payment completed",
    sw: "Malipo yamefanikiwa",
  },
  1: {
    outcome: "failed",
    en: "Insufficient balance",
    sw: "Salio halitoshi",
  },
  17: {
    outcome: "failed",
    en: "The amount would exceed the maximum balance",
    sw: "Kiwango kimezidi kikomo cha salio",
  },
  1001: {
    outcome: "failed",
    en: "Another transaction is already in progress for this number",
    sw: "Muamala mwingine unaendelea kwa nambari hii",
  },
  1019: {
    outcome: "failed",
    en: "The transaction has expired",
    sw: "Muamala umeisha muda",
  },
  1025: {
    outcome: "failed",
    en: "The STK push could not be sent",
    sw: "Imeshindwa kutuma ombi la STK",
  },
  1032: {
    outcome: "cancelled",
    en: "The customer cancelled the request",
    sw: "Mteja ameghairi ombi",
  },
  1037: {
    outcome: "failed",
    en: "The phone timed out and could not be reached",
    sw: "Muda umeisha. Simu haikupatikana",
  },
  2001: {
    outcome: "failed",
    en: "The initiator information is invalid",
    sw: "Taarifa ya kuanzisha muamala si sahihi",
  },
  4999: {
    outcome: "pending",
    en: "The transaction is still processing",
    sw: "Muamala bado unaendelea",
  },
  9999: {
    outcome: "failed",
    en: "The request failed",
    sw: "Ombi limeshindwa",
  },
};

export function explainResult(code: number): ResultExplanation {
  const known = CODES[code];
  if (known) return { code, ...known };
  return {
    code,
    outcome: "unknown",
    en: `Daraja result code ${code}`,
    sw: `Msimbo wa matokeo ${code}`,
  };
}

export function statusFromResult(code: number): "success" | "cancelled" | "failed" | "pending" {
  const outcome = explainResult(code).outcome;
  if (outcome === "success") return "success";
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "pending") return "pending";
  return "failed";
}
