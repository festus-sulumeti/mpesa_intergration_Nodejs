import type { AgentInput } from "../src/agent/run";
import { runAgent } from "../src/agent/run";

export async function runExample(input: AgentInput): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  if (!confirm) {
    console.log(JSON.stringify(await runAgent({ ...input, confirm: false }), null, 2));
    return;
  }

  const { createDarajaClient } = await import("../src/daraja/client");
  const { loadConfig } = await import("../src/daraja/config");
  const { createFileStore } = await import("../src/store/transactions");
  const result = await runAgent(
    { ...input, confirm: true },
    {
      client: createDarajaClient(loadConfig()),
      store: createFileStore(process.env.MPESA_STORE_PATH || "data/transactions.json"),
    }
  );
  console.log(JSON.stringify(result, null, 2));
}
