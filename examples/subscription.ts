import { runExample } from "./run-example";

runExample({
  message: "Collect KES 1000 from 0712345678 for SUB202611",
  transactionDesc: "Subscription",
  idempotencyKey: "sub-254712345678-202611",
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Example failed");
  process.exitCode = 1;
});