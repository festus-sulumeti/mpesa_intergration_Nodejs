import { runExample } from "./run-example";

runExample({
  message: "Collect KES 500 from 0712345678 for January chama",
  transactionDesc: "January chama",
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Example failed");
  process.exitCode = 1;
});
