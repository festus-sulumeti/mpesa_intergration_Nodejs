import { runExample } from "./run-example";

runExample({
  message: "Collect KES 150 from 0712345678 for TILLPAY",
  transactionType: "CustomerBuyGoodsOnline",
  partyB: process.env.MPESA_TILL || "174379",
  transactionDesc: "Till pay",
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Example failed");
  process.exitCode = 1;
});
