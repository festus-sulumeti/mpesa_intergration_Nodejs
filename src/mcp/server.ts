import { createDarajaClient } from "../daraja/client";
import { loadConfig } from "../daraja/config";
import { createSqliteStore } from "../store/sqlite";
import { startMcpServer } from "./protocol";

const store = createSqliteStore(process.env.MPESA_DB_PATH || "data/daraja.sqlite");

try {
  startMcpServer({ client: createDarajaClient(loadConfig()), store });
} catch (err) {
  console.error(err instanceof Error ? err.message : "Daraja credentials are not configured");
  startMcpServer({ store });
}
