import { createDarajaClient } from "../daraja/client";
import { loadConfig } from "../daraja/config";
import { createFileStore } from "../store/transactions";
import { startMcpServer } from "./protocol";

const store = createFileStore(process.env.MPESA_STORE_PATH || "data/transactions.json");

try {
  startMcpServer({ client: createDarajaClient(loadConfig()), store });
} catch (err) {
  console.error(err instanceof Error ? err.message : "Daraja credentials are not configured");
  startMcpServer({ store });
}
