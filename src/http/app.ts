import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { runAgent } from "../agent/run";
import { callTool, type ToolContext } from "../agent/tools";
import { parseC2B } from "../daraja/c2b";
import type { TransactionType } from "../daraja/client";
import { DarajaError } from "../daraja/errors";
import { applyCommandResult, applyStkCallback, recordC2BConfirmation } from "./callbacks";

export interface AppOptions {
  apiKey: string;
}

export function createApp(ctx: ToolContext, options: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());
  const guard = requireApiKey(options.apiKey);

  app.get("/", (_req, res) => {
    res.json({
      service: "Daraja Lipa na M-Pesa",
      env: ctx.client?.settings.env ?? "unconfigured",
      shortcode: ctx.client?.settings.shortcode ?? null,
      amountCap: ctx.client?.settings.amountCap ?? null,
      payoutsConfigured: ctx.client?.settings.payoutsConfigured ?? false,
      endpoints: [
        "POST /stk",
        "POST /callback",
        "GET /stk/:checkoutRequestId",
        "GET /transactions",
        "POST /agent",
        "POST /c2b/register",
        "POST /c2b/validation",
        "POST /c2b/confirmation",
        "POST /b2c",
        "POST /b2c/result",
        "POST /b2c/timeout",
        "POST /balance",
        "POST /balance/result",
        "POST /balance/timeout",
        "POST /reversal",
        "POST /reversal/result",
        "POST /reversal/timeout",
      ],
    });
  });

  app.post("/stk", guard, asyncRoute(async (req, res) => {
    const result = await callTool("stk_push", bodyRecord(req.body), ctx, { revealPhone: true });
    res.status(result.data.replayed === true ? 200 : 201).json(result.data);
  }));

  app.post("/callback", asyncRoute(async (req, res) => {
    const transaction = applyStkCallback(ctx.store, req.body);
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted",
      status: transaction?.status ?? "ignored",
    });
  }));

  app.get("/stk/:checkoutRequestId", guard, asyncRoute(async (req, res) => {
    const result = await callTool(
      "query_stk",
      { checkoutRequestId: String(req.params.checkoutRequestId) },
      ctx,
      { revealPhone: true }
    );
    res.json(result.data);
  }));

  app.get("/transactions", guard, asyncRoute(async (_req, res) => {
    const result = await callTool("list_transactions", {}, ctx, { revealPhone: true });
    res.json(result.data);
  }));

  app.post("/agent", guard, asyncRoute(async (req, res) => {
    const body = bodyRecord(req.body);
    const result = await runAgent(
      {
        message: typeof body.message === "string" ? body.message : "",
        confirm: body.confirm === true,
        accountReference: typeof body.accountReference === "string" ? body.accountReference : undefined,
        transactionDesc: typeof body.transactionDesc === "string" ? body.transactionDesc : undefined,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        transactionType: transactionType(body.transactionType),
        partyB: typeof body.partyB === "string" ? body.partyB : undefined,
      },
      ctx
    );
    res.status(result.needsConfirmation ? 409 : 200).json(result);
  }));

  app.post("/c2b/register", guard, asyncRoute(async (req, res) => {
    const result = await callTool("register_c2b", bodyRecord(req.body), ctx);
    res.status(201).json(result.data);
  }));

  app.post("/c2b/validation", (req, res) => {
    try {
      parseC2B(req.body);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch {
      res.json({ ResultCode: 1, ResultDesc: "Rejected" });
    }
  });

  app.post("/c2b/confirmation", asyncRoute(async (req, res) => {
    const transaction = recordC2BConfirmation(ctx.store, req.body);
    res.json({ ResultCode: 0, ResultDesc: "Accepted", status: transaction.status });
  }));

  app.post("/b2c", guard, asyncRoute(async (req, res) => {
    const result = await callTool("b2c_payment", bodyRecord(req.body), ctx, { revealPhone: true });
    res.status(result.data.replayed === true ? 200 : 201).json(result.data);
  }));
  app.post("/balance", guard, asyncRoute(async (_req, res) => {
    const result = await callTool("account_balance", {}, ctx);
    res.status(201).json(result.data);
  }));
  app.post("/reversal", guard, asyncRoute(async (req, res) => {
    const result = await callTool("reversal", bodyRecord(req.body), ctx);
    res.status(result.data.replayed === true ? 200 : 201).json(result.data);
  }));

  app.post("/b2c/result", resultRoute(ctx, false));
  app.post("/b2c/timeout", resultRoute(ctx, true));
  app.post("/balance/result", resultRoute(ctx, false));
  app.post("/balance/timeout", resultRoute(ctx, true));
  app.post("/reversal/result", resultRoute(ctx, false));
  app.post("/reversal/timeout", resultRoute(ctx, true));

  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof DarajaError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON", code: "json" });
      return;
    }
    res.status(500).json({ error: "Request failed", code: "internal" });
  };
  app.use(handleError);
  return app;
}

function resultRoute(ctx: ToolContext, timeout: boolean) {
  return asyncRoute(async (req, res) => {
    const transaction = applyCommandResult(ctx.store, req.body, timeout);
    res.json({
      ResultCode: 0,
      ResultDesc: "Accepted",
      status: transaction?.status ?? "ignored",
    });
  });
}

function requireApiKey(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("x-api-key") ?? "";
    const authorization = req.header("authorization") ?? "";
    const bearer = authorization.replace(/^Bearer\s+/i, "");
    const provided = header || (authorization.toLowerCase().startsWith("bearer ") ? bearer : "");
    if (!apiKey || !sameKey(apiKey, provided)) {
      res.status(401).json({ error: "API key required", code: "unauthorized" });
      return;
    }
    next();
  };
}

function sameKey(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    handler(req, res).catch(next);
  };
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function transactionType(value: unknown): TransactionType | undefined {
  if (value === "CustomerPayBillOnline" || value === "CustomerBuyGoodsOnline") return value;
  return undefined;
}
