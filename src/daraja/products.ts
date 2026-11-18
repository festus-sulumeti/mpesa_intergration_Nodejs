import { baseUrl, type DarajaConfig } from "./config";
import { DarajaError, publicHttpError } from "./errors";
import type { HttpClient } from "./client";
import { parseAmount } from "./money";
import { normalizeKenyanPhone } from "./phone";

export interface ProductRuntime {
  config: DarajaConfig;
  http: HttpClient;
  getAccessToken(): Promise<string>;
}

export interface RegisteredUrls {
  responseCode: string;
  responseDescription: string;
}

export interface AcceptedCommand {
  conversationId: string;
  originatorConversationId: string;
  responseDescription: string;
}

export async function registerC2bUrls(
  runtime: ProductRuntime,
  input: { validationUrl: string; confirmationUrl: string; responseType?: "Completed" | "Cancelled" }
): Promise<RegisteredUrls> {
  const validationUrl = input.validationUrl || runtime.config.c2bValidationUrl || "";
  const confirmationUrl = input.confirmationUrl || runtime.config.c2bConfirmationUrl || "";
  if (!validationUrl || !confirmationUrl) {
    throw new DarajaError(
      "C2B validation and confirmation URLs are required",
      "c2b",
      500
    );
  }
  const data = await post<RegisteredResponse>(runtime, "/mpesa/c2b/v1/registerurl", {
    ShortCode: runtime.config.shortcode,
    ResponseType: input.responseType ?? "Completed",
    ConfirmationURL: confirmationUrl,
    ValidationURL: validationUrl,
  });
  if (data.ResponseCode !== "0") {
    throw new DarajaError(data.ResponseDescription || "C2B URL registration was rejected", "c2b_rejected", 502);
  }
  return {
    responseCode: data.ResponseCode,
    responseDescription: data.ResponseDescription ?? "success",
  };
}

export async function sendB2C(
  runtime: ProductRuntime,
  input: { phone: string; amount: number | string; remarks?: string; occasion?: string }
): Promise<AcceptedCommand & { phone: string; amount: number }> {
  const initiator = requireInitiator(runtime.config);
  const phone = normalizeKenyanPhone(input.phone);
  const amount = parseAmount(input.amount, runtime.config.amountCap);
  const resultUrl = requiredUrl(runtime.config.b2cResultUrl, "MPESA_B2C_RESULT_URL");
  const timeoutUrl = requiredUrl(runtime.config.b2cTimeoutUrl, "MPESA_B2C_TIMEOUT_URL");
  const data = await post<CommandResponse>(runtime, "/mpesa/b2c/v1/paymentrequest", {
    InitiatorName: initiator.name,
    SecurityCredential: initiator.credential,
    CommandID: "BusinessPayment",
    Amount: amount,
    PartyA: runtime.config.shortcode,
    PartyB: phone,
    Remarks: clip(input.remarks || "B2C payment", 100),
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
    Occasion: clip(input.occasion || "B2C", 100),
  });
  return { ...accepted(data, "b2c_rejected"), phone, amount };
}

export async function queryBalance(runtime: ProductRuntime): Promise<AcceptedCommand> {
  const initiator = requireInitiator(runtime.config);
  const resultUrl = requiredUrl(runtime.config.balanceResultUrl, "MPESA_BALANCE_RESULT_URL");
  const timeoutUrl = requiredUrl(runtime.config.balanceTimeoutUrl, "MPESA_BALANCE_TIMEOUT_URL");
  const data = await post<CommandResponse>(runtime, "/mpesa/accountbalance/v1/query", {
    Initiator: initiator.name,
    SecurityCredential: initiator.credential,
    CommandID: "AccountBalance",
    PartyA: runtime.config.shortcode,
    IdentifierType: "4",
    Remarks: "balance",
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
  });
  return accepted(data, "balance_rejected");
}

export async function reverseTransaction(
  runtime: ProductRuntime,
  input: { receipt: string; amount: number | string; remarks?: string }
): Promise<AcceptedCommand & { receipt: string; amount: number }> {
  const initiator = requireInitiator(runtime.config);
  const amount = parseAmount(input.amount, runtime.config.amountCap);
  const receipt = input.receipt.trim();
  if (!receipt) throw new DarajaError("M-Pesa receipt is required", "reversal");
  const resultUrl = requiredUrl(runtime.config.reversalResultUrl, "MPESA_REVERSAL_RESULT_URL");
  const timeoutUrl = requiredUrl(runtime.config.reversalTimeoutUrl, "MPESA_REVERSAL_TIMEOUT_URL");
  const data = await post<CommandResponse>(runtime, "/mpesa/reversal/v1/request", {
    Initiator: initiator.name,
    SecurityCredential: initiator.credential,
    CommandID: "TransactionReversal",
    TransactionID: receipt,
    Amount: amount,
    ReceiverParty: runtime.config.shortcode,
    RecieverIdentifierType: "11",
    ResultURL: resultUrl,
    QueueTimeOutURL: timeoutUrl,
    Remarks: clip(input.remarks || "Reversal", 100),
    Occasion: "Reversal",
  });
  return { ...accepted(data, "reversal_rejected"), receipt, amount };
}

async function post<T>(runtime: ProductRuntime, path: string, body: unknown): Promise<T> {
  try {
    const token = await runtime.getAccessToken();
    const response = await runtime.http.post<T>(`${baseUrl(runtime.config.env)}${path}`, body, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (err) {
    if (err instanceof DarajaError) throw err;
    throw new DarajaError(publicHttpError(err), "daraja_failed", 502);
  }
}

function requireInitiator(config: DarajaConfig): { name: string; credential: string } {
  if (!config.initiatorName || !config.securityCredential) {
    throw new DarajaError(
      "MPESA_INITIATOR_NAME and MPESA_SECURITY_CREDENTIAL are required",
      "config",
      500
    );
  }
  return { name: config.initiatorName, credential: config.securityCredential };
}

function requiredUrl(value: string | undefined, name: string): string {
  if (!value) throw new DarajaError(`${name} is required`, "config", 500);
  return value;
}

function accepted(data: CommandResponse, code: string): AcceptedCommand {
  if (data.ResponseCode !== "0" || !data.ConversationID) {
    throw new DarajaError(data.ResponseDescription || "Daraja rejected the request", code, 502);
  }
  return {
    conversationId: data.ConversationID,
    originatorConversationId: data.OriginatorConversationID ?? "",
    responseDescription: data.ResponseDescription ?? "",
  };
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

interface RegisteredResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
}

interface CommandResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
  ConversationID?: string;
  OriginatorConversationID?: string;
}
