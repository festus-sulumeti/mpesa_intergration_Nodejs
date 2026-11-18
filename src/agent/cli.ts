import { planMessage } from "./plan";
import { createDarajaClient } from "../daraja/client";
import { loadConfig } from "../daraja/config";
import { createSqliteStore } from "../store/sqlite";
import { openAiComplete } from "./llm";
import { runAgent } from "./run";

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const message = process.argv.slice(2).filter((arg) => arg !== "--confirm").join(" ").trim();
  if (!message) {
    console.error('Usage: pnpm agent -- "Send KES 500 to 0712345678 for January chama"');
    process.exitCode = 1;
    return;
  }

  const plan = planMessage(message);
  const store = createSqliteStore(process.env.MPESA_DB_PATH || "data/daraja.sqlite");
  const needsDaraja =
    plan.intent === "query" ||
    plan.intent === "balance" ||
    ((plan.intent === "stk" || plan.intent === "reversal") && confirm);
  const client = needsDaraja ? createDarajaClient(loadConfig()) : undefined;
  const llm =
    confirm && process.env.AGENT_API_KEY
      ? openAiComplete({
          apiKey: process.env.AGENT_API_KEY,
          baseUrl: process.env.AGENT_BASE_URL,
          model: process.env.AGENT_MODEL,
        })
      : undefined;

  const result = await runAgent(
    { message, confirm: confirm && (plan.intent === "stk" || plan.intent === "reversal"), llm },
    { client, store }
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Agent failed");
  process.exitCode = 1;
});
