import type { DarajaConfig } from "../src/daraja/config";
import { createDarajaClient, type HttpClient, type StkQueryResult } from "../src/daraja/client";
import { createMemoryStore } from "../src/store/transactions";
import type { ToolContext } from "../src/agent/tools";

export const testConfig: DarajaConfig = {
  env: "sandbox",
  consumerKey: "consumer-key",
  consumerSecret: "consumer-secret",
  passkey: "pass",
  shortcode: "174379",
  callbackUrl: "https://example.test/callback",
  amountCap: 10_000,
};

export interface RecordedCall {
  url: string;
  body?: unknown;
  headers: Record<string, string>;
}

export function createFakeHttp(query: Partial<StkQueryResult> = {}): {
  http: HttpClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const http: HttpClient = {
    async get(url, config) {
      calls.push({ url, headers: config.headers });
      return { data: { access_token: "token-1", expires_in: "3600" } };
    },
    async post(url, body, config) {
      calls.push({ url, body, headers: config.headers });
      if (url.includes("stkpushquery")) {
        return {
          data: {
            ResponseCode: "0",
            ResponseDescription: "accepted",
            ResultCode: query.resultCode ?? 0,
            ResultDesc: query.resultDesc ?? "The service request is processed successfully.",
            CheckoutRequestID: "ws_CO_1",
            MerchantRequestID: "merchant-1",
          },
        };
      }
      return {
        data: {
          ResponseCode: "0",
          ResponseDescription: "Success",
          CustomerMessage: "Success. Request accepted for processing",
          CheckoutRequestID: "ws_CO_1",
          MerchantRequestID: "merchant-1",
        },
      };
    },
  };
  return { http, calls };
}

export function testContext(options?: {
  now?: () => Date;
  query?: Partial<StkQueryResult>;
}): { ctx: ToolContext; calls: RecordedCall[] } {
  const { http, calls } = createFakeHttp(options?.query);
  return {
    calls,
    ctx: {
      client: createDarajaClient(testConfig, http, options?.now ?? (() => new Date("2026-01-15T21:05:09.000Z"))),
      store: createMemoryStore(),
      now: options?.now ?? (() => new Date("2026-01-15T21:05:09.000Z")),
    },
  };
}
