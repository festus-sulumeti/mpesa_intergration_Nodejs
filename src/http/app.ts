import cors from "cors";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { runAgent } from "../agent/run";
import { callTool, type ToolContext } from "../agent/tools";
import { parseCallback } from "../daraja/callback";
import type { TransactionType } from "../daraja/client";
import { DarajaError } from "../daraja/errors";
import { statusFromResult } from "../daraja/result-codes";
import { newTransactionId, type Transaction } from "../store/transactions";

export function createApp(ctx: ToolContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      service: "Daraja Lipa na M-Pesa",
      env: ctx.client?.settings.env ?? "unconfigured",
      shortcode: ctx.client?.settings.shortcode ?? null,
      amountCap: ctx.client?.settings.amountCap ?? null,
      endpoints: [
        "POST /stk",
        "POST /callback",
        "GET /stk/:checkoutRequestId",
        "GET /transactions",
        "POST /agent",
      ],
    });
  });

  app.post("/stk", asyncRoute(async (req, res) => {
    const result = await callTool("stk_push", bodyRecord(req.body), ctx, { revealPhone: true });
    res.status(result.data.replayed === true ? 200 : 201).json(result.data);
  }));

  app.post("/callback", asyncRoute(async (req, res) => {
    const parsed = parseCallback(req.body);
    const transaction = applyCallback(ctx, parsed);
    res.json({ ResultCode: 0, ResultDesc: "Accepted", status: transaction.status });
  }));

  app.get("/stk/:checkoutRequestId", asyncRoute(async (req, res) => {
    const result = await callTool(
      "query_stk",
      { checkoutRequestId: String(req.params.checkoutRequestId) },
      ctx,
      { revealPhone: true }
    );
    res.json(result.data);
  }));

  app.get("/transactions", asyncRoute(async (_req, res) => {
    const result = await callTool("list_transactions", {}, ctx, { revealPhone: true });
    res.json(result.data);
  }));

  app.post("/agent", asyncRoute(async (req, res) => {
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

function applyCallback(
  ctx: ToolContext,
  parsed: ReturnType<typeof parseCallback>
): Transaction {
  const existing = ctx.store.findByCheckout(parsed.checkoutRequestId);
  if (!existing) {
    const created: Transaction = {
      id: newTransactionId(),
      idempotencyKey: `callback:${parsed.checkoutRequestId}`,
      phone: parsed.phone ?? "",
      amount: parsed.amount ?? 0,
      accountReference: "CALLBACK",
      transactionDesc: "Callback",
      checkoutRequestId: parsed.checkoutRequestId,
      merchantRequestId: parsed.merchantRequestId,
      status: statusFromResult(parsed.resultCode),
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      receipt: parsed.receipt,
      createdAt: new Date().toISOString(),
    };
    ctx.store.insert(created);
    return created;
  }

  const updated: Transaction = {
    ...existing,
    merchantRequestId: parsed.merchantRequestId || existing.merchantRequestId,
    status: statusFromResult(parsed.resultCode),
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    receipt: parsed.receipt ?? existing.receipt,
  };
  ctx.store.save(updated);
  return updated;
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
