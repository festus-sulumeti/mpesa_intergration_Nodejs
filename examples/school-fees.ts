import { runExample } from "./run-example";

runExample({
  message: "Send 200 to 254711111111 for school fees",
  transactionDesc: "School fees",
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Example failed");
  process.exitCode = 1;
});
