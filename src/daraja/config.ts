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
}

export interface PublicDarajaConfig {
  env: DarajaEnv;
  shortcode: string;
  callbackUrl: string;
  amountCap: number;
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
  };
}

export function publicConfig(config: DarajaConfig): PublicDarajaConfig {
  return {
    env: config.env,
    shortcode: config.shortcode,
    callbackUrl: config.callbackUrl,
    amountCap: config.amountCap,
  };
}
