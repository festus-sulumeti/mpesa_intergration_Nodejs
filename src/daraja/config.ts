import { DarajaError } from "./errors";

export type DarajaEnv = "sandbox" | "production";

export interface DarajaConfig {
  env: DarajaEnv;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  callbackUrl: string;
  amountCap: number;
  initiatorName?: string;
  securityCredential?: string;
  c2bValidationUrl?: string;
  c2bConfirmationUrl?: string;
  b2cResultUrl?: string;
  b2cTimeoutUrl?: string;
  reversalResultUrl?: string;
  reversalTimeoutUrl?: string;
  balanceResultUrl?: string;
  balanceTimeoutUrl?: string;
}

export interface PublicDarajaConfig {
  env: DarajaEnv;
  shortcode: string;
  callbackUrl: string;
  amountCap: number;
  payoutsConfigured: boolean;
}

export function baseUrl(env: DarajaEnv): string {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DarajaConfig {
  const mode = (env.MPESA_ENV ?? "sandbox").toLowerCase();
  if (mode !== "sandbox" && mode !== "production") {
    throw new DarajaError("MPESA_ENV must be sandbox or production", "config", 500);
  }

  const missing = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL",
  ].filter((key) => !env[key]);
  if (mode === "production" && !env.MPESA_SHORTCODE) missing.push("MPESA_SHORTCODE");
  if (missing.length > 0) {
    throw new DarajaError(`Missing ${missing.join(", ")}`, "config", 500);
  }

  const amountCap = env.MPESA_AMOUNT_CAP ? Number(env.MPESA_AMOUNT_CAP) : 10_000;
  if (!Number.isInteger(amountCap) || amountCap < 1) {
    throw new DarajaError(
      "MPESA_AMOUNT_CAP must be a positive whole number of shillings",
      "config",
      500
    );
  }

  return {
    env: mode,
    consumerKey: env.MPESA_CONSUMER_KEY as string,
    consumerSecret: env.MPESA_CONSUMER_SECRET as string,
    passkey: env.MPESA_PASSKEY as string,
    shortcode: env.MPESA_SHORTCODE || "174379",
    callbackUrl: env.MPESA_CALLBACK_URL as string,
    amountCap,
    initiatorName: env.MPESA_INITIATOR_NAME,
    securityCredential: env.MPESA_SECURITY_CREDENTIAL,
    c2bValidationUrl: env.MPESA_C2B_VALIDATION_URL,
    c2bConfirmationUrl: env.MPESA_C2B_CONFIRMATION_URL,
    b2cResultUrl: env.MPESA_B2C_RESULT_URL,
    b2cTimeoutUrl: env.MPESA_B2C_TIMEOUT_URL,
    reversalResultUrl: env.MPESA_REVERSAL_RESULT_URL,
    reversalTimeoutUrl: env.MPESA_REVERSAL_TIMEOUT_URL,
    balanceResultUrl: env.MPESA_BALANCE_RESULT_URL,
    balanceTimeoutUrl: env.MPESA_BALANCE_TIMEOUT_URL,
  };
}

export function loadServerSettings(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  dbPath: string;
  queryAfterMs: number;
} {
  const apiKey = env.MPESA_API_KEY ?? "";
  if (!apiKey) {
    throw new DarajaError("MPESA_API_KEY is required", "config", 500);
  }
  const queryAfterMs = env.MPESA_QUERY_AFTER_MS ? Number(env.MPESA_QUERY_AFTER_MS) : 30_000;
  if (!Number.isInteger(queryAfterMs) || queryAfterMs < 0) {
    throw new DarajaError("MPESA_QUERY_AFTER_MS must be a whole number of milliseconds", "config", 500);
  }
  return {
    apiKey,
    dbPath: env.MPESA_DB_PATH || "data/daraja.sqlite",
    queryAfterMs,
  };
}

export function publicConfig(config: DarajaConfig): PublicDarajaConfig {
  return {
    env: config.env,
    shortcode: config.shortcode,
    callbackUrl: config.callbackUrl,
    amountCap: config.amountCap,
    payoutsConfigured: Boolean(config.initiatorName && config.securityCredential),
  };
}
