import { createDarajaClient } from "./daraja/client";
import { loadConfig, loadServerSettings } from "./daraja/config";
import { createApp } from "./http/app";
import { watchPendingStk } from "./http/watch";
import { createSqliteStore } from "./store/sqlite";
import type { ToolContext } from "./agent/tools";

const config = loadConfig();
const server = loadServerSettings();
const ctx: ToolContext = {
  client: createDarajaClient(config),
  store: createSqliteStore(server.dbPath),
};
ctx.onStkAccepted = (checkoutRequestId) => {
  watchPendingStk(ctx, checkoutRequestId, server.queryAfterMs);
};

const app = createApp(ctx, { apiKey: server.apiKey });
const port = Number(process.env.PORT || 5001);

app.listen(port, () => {
  console.log(`Daraja reference server listening on ${port} (${config.env})`);
});
