import { createDarajaClient } from "./daraja/client";
import { loadConfig } from "./daraja/config";
import { createApp } from "./http/app";
import { createFileStore } from "./store/transactions";

const config = loadConfig();
const app = createApp({
  client: createDarajaClient(config),
  store: createFileStore(process.env.MPESA_STORE_PATH || "data/transactions.json"),
});
const port = Number(process.env.PORT || 5001);

app.listen(port, () => {
  console.log(`Daraja reference server listening on ${port} (${config.env})`);
});
