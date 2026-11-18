import axios from "axios";
import { parseAmount, toAccountReference, toTransactionDesc } from "./money";
import { baseUrl, type DarajaConfig, publicConfig, type PublicDarajaConfig } from "./config";
import { DarajaError, publicHttpError } from "./errors";
import { normalizeKenyanPhone } from "./phone";
import { darajaTimestamp, stkPassword } from "./time";
import {
  queryBalance,
  registerC2bUrls,
  reverseTransaction,
  sendB2C,
  type AcceptedCommand,
  type RegisteredUrls,
} from "./products";

export interface HttpClient {
  get<T>(url: string, config: { headers: Record<string, string> }): Promise<{ data: T }>;
  post<T>(
    url: string,
    body: unknown,
    config: { headers: Record<string, string> }
  ): Promise<{ data: T }>;
}

export const axiosHttp: HttpClient = {
  async get(url, config) {
    const response = await axios.get(url, config);
    return { data: response.data };
  },
  async post(url, body, config) {
    const response = await axios.post(url, body, config);
    return { data: response.data };
  },
};

export type TransactionType = "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";

export interface StkPushInput {
  phone: string;
  amount: number | string;
  accountReference: string;
  transactionDesc: string;
  transactionType?: TransactionType;
  partyB?: string;
}

export interface StkAccepted {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
  phone: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
  transactionType: TransactionType;
  partyB: string;
}

export interface StkQueryResult {
  responseCode: string;
  responseDescription: string;
  resultCode?: number;
  resultDesc?: string;
  checkoutRequestId: string;
  merchantRequestId?: string;
}

interface OAuthResponse {
  access_token?: string;
  expires_in?: string;
}

interface StkApiResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  ResultCode?: string | number;
  ResultDesc?: string;
}

export interface DarajaClient {
  readonly settings: PublicDarajaConfig;
  getAccessToken(): Promise<string>;
  stkPush(input: StkPushInput): Promise<StkAccepted>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
  registerC2bUrls(input: {
    validationUrl?: string;
    confirmationUrl?: string;
    responseType?: "Completed" | "Cancelled";
  }): Promise<RegisteredUrls>;
  b2c(input: { phone: string; amount: number | string; remarks?: string; occasion?: string }): Promise<
    AcceptedCommand & { phone: string; amount: number }
  >;
  accountBalance(): Promise<AcceptedCommand>;
  reversal(input: { receipt: string; amount: number | string; remarks?: string }): Promise<
    AcceptedCommand & { receipt: string; amount: number }
  >;
}

export function createDarajaClient(
  config: DarajaConfig,
  http: HttpClient = axiosHttp,
  now: () => Date = () => new Date()
): DarajaClient {
  let cache: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(): Promise<string> {
    const current = now().getTime();
    if (cache && cache.expiresAt > current + 10_000) return cache.token;

    try {
      const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
      const response = await http.get<OAuthResponse>(
        `${baseUrl(config.env)}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { authorization: `Basic ${auth}` } }
      );
      if (!response.data.access_token) {
        throw new DarajaError("Daraja did not return an access token", "oauth", 502);
      }
      const expiresIn = Number(response.data.expires_in);
      const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3599;
      cache = {
        token: response.data.access_token,
        expiresAt: current + ttl * 1000,
      };
      return cache.token;
    } catch (err) {
      if (err instanceof DarajaError) throw err;
      throw new DarajaError(publicHttpError(err), "oauth", 502);
    }
  }

  async function stkPush(input: StkPushInput): Promise<StkAccepted> {
    const phone = normalizeKenyanPhone(input.phone);
    const amount = parseAmount(input.amount, config.amountCap);
    const accountReference = toAccountReference(input.accountReference);
    const transactionDesc = toTransactionDesc(input.transactionDesc);
    const transactionType = input.transactionType ?? "CustomerPayBillOnline";
    const partyB = input.partyB ? normalizeParty(input.partyB) : config.shortcode;
    const timestamp = darajaTimestamp(now());
    const token = await getAccessToken();
    const body = {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    };

    try {
      const response = await http.post<StkApiResponse>(
        `${baseUrl(config.env)}/mpesa/stkpush/v1/processrequest`,
        body,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.data.ResponseCode !== "0" || !response.data.CheckoutRequestID) {
        throw new DarajaError(
          response.data.ResponseDescription || "STK push was rejected",
          "stk_rejected",
          502
        );
      }
      return {
        merchantRequestId: response.data.MerchantRequestID ?? "",
        checkoutRequestId: response.data.CheckoutRequestID,
        customerMessage: response.data.CustomerMessage ?? "",
        phone,
        amount,
        accountReference,
        transactionDesc,
        transactionType,
        partyB,
      };
    } catch (err) {
      if (err instanceof DarajaError) throw err;
      throw new DarajaError(publicHttpError(err), "stk_failed", 502);
    }
  }

  async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    if (!checkoutRequestId) {
      throw new DarajaError("CheckoutRequestID is required", "query");
    }
    const timestamp = darajaTimestamp(now());
    const token = await getAccessToken();
    const body = {
      BusinessShortCode: config.shortcode,
      Password: stkPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    try {
      const response = await http.post<StkApiResponse>(
        `${baseUrl(config.env)}/mpesa/stkpushquery/v1/query`,
        body,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const resultCode =
        response.data.ResultCode == null || response.data.ResultCode === ""
          ? undefined
          : Number(response.data.ResultCode);
      return {
        responseCode: response.data.ResponseCode ?? "",
        responseDescription: response.data.ResponseDescription ?? "",
        resultCode: resultCode !== undefined && Number.isInteger(resultCode) ? resultCode : undefined,
        resultDesc: response.data.ResultDesc,
        checkoutRequestId: response.data.CheckoutRequestID || checkoutRequestId,
        merchantRequestId: response.data.MerchantRequestID,
      };
    } catch (err) {
      if (err instanceof DarajaError) throw err;
      throw new DarajaError(publicHttpError(err), "query_failed", 502);
    }
  }

  const runtime = { config, http, getAccessToken };

  return {
    settings: publicConfig(config),
    getAccessToken,
    stkPush,
    stkQuery,
    registerC2bUrls: (input) =>
      registerC2bUrls(runtime, {
        validationUrl: input.validationUrl ?? "",
        confirmationUrl: input.confirmationUrl ?? "",
        responseType: input.responseType,
      }),
    b2c: (input) => sendB2C(runtime, input),
    accountBalance: () => queryBalance(runtime),
    reversal: (input) => reverseTransaction(runtime, input),
  };
}

function normalizeParty(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{5,12}$/.test(digits)) {
    throw new DarajaError("PartyB must be a shortcode or till number", "party_b");
  }
  return digits;
}
