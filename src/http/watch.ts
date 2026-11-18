import { callTool, type ToolContext } from "../agent/tools";

export function watchPendingStk(
  ctx: ToolContext,
  checkoutRequestId: string,
  delayMs: number
): void {
  const timer = setTimeout(() => {
    void queryIfStillPending(ctx, checkoutRequestId);
  }, delayMs);
  timer.unref?.();
}

async function queryIfStillPending(ctx: ToolContext, checkoutRequestId: string): Promise<void> {
  const existing = ctx.store.findByCheckout(checkoutRequestId);
  if (!existing || existing.status !== "pending") return;
  try {
    await callTool("query_stk", { checkoutRequestId }, ctx);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "STK status query failed");
  }
}
