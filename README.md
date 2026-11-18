# Daraja Lipa na M-Pesa

A TypeScript Daraja client, a small reference server, and a payments agent for Kenyan developers. The agent can normalize a phone number, explain a result code, and send an STK push only after a person sets `confirm=true`.

The library is the part to import. The server and the agent are the reference for how to use it.

## Safety

- Credentials live in the environment. They are never written into tool results or the agent prompt.
- The default environment is sandbox, and the shortcode defaults to `174379`.
- Amounts are whole shillings. The agent will not send more than `MPESA_AMOUNT_CAP` (default `10000`).
- The same idempotency key is not sent to Daraja twice. The default key is the phone, amount, account reference, and Nairobi date.
- Phone numbers on agent and MCP results are masked. The reference HTTP API returns the full number because that server is yours.

## Setup

```bash
npm install
cp .env.example .env
npm test
npm start
```

`npm start` watches `src/server.ts`. `npm run build` then `npm run serve` runs the compiled server. The default port is `5001`.

## Callback URL

Daraja calls you after the customer accepts or cancels. The URL has to be public HTTPS.

```bash
ngrok http 5001
# MPESA_CALLBACK_URL=https://<id>.ngrok-free.app/callback
```

```bash
cloudflared tunnel --url http://localhost:5001
# MPESA_CALLBACK_URL=https://<host>.trycloudflare.com/callback
```

The callback route is `POST /callback`.

## Use the client

```ts
import { createDarajaClient, loadConfig } from "./src/index";

const daraja = createDarajaClient(loadConfig());
const accepted = await daraja.stkPush({
  phone: "0712345678",
  amount: 500,
  accountReference: "CHAMA",
  transactionDesc: "January chama",
});
```

`0712345678`, `0112345678`, `254712345678`, and `+254712345678` are normalized to `254…`. A value that would become `25407…` is rejected. Timestamps use `Africa/Nairobi`.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Service description, with no secrets |
| `POST` | `/stk` | STK push. Refuses the call until `confirm` is `true` |
| `POST` | `/callback` | Daraja STK callback. Updates the local ledger |
| `GET` | `/stk/:checkoutRequestId` | Query Daraja and update the ledger |
| `GET` | `/transactions` | Ledger, newest first |
| `POST` | `/agent` | `{ "message": "Send KES 500 to 0712345678 for January chama" }` |

`AccountReference` is at most 12 letters or digits. `TransactionDesc` is at most 13 characters. A missing confirmation returns `409` and does not call Daraja.

The ledger is `data/transactions.json` unless `MPESA_STORE_PATH` is set.

## Agent

Without `AGENT_API_KEY`, a built-in planner handles a fixed set of English and Kiswahili phrases. With an OpenAI-compatible key, the model may choose tools, but it still cannot set `confirm`. Only the caller can.

```bash
npm run agent -- "Nitumie stk ya mia tano kwa 0712345678"
npm run agent -- --confirm "Send KES 500 to 0712345678 for January chama"
```

The first command prints a confirmation in English and Kiswahili. The second sends the prompt only when `.env` is filled in.

Examples, all safe to run with no credentials:

```bash
npm run example:chama
npm run example:school
npm run example:till
npm run example:subscription
```

Add `--confirm` to send a sandbox push. The subscription example uses a monthly idempotency key so the same month is not charged twice. The till example uses `CustomerBuyGoodsOnline`.

## MCP

`npm run mcp` speaks MCP over stdin and stdout. Point a coding agent at it:

```json
{
  "mcpServers": {
    "daraja": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/this/repo"
    }
  }
}
```

Tools: `normalize_phone`, `stk_push`, `query_stk`, `explain_result`, `list_transactions`. `stk_push` does nothing unless its `confirm` argument is `true`.

## Result codes

`explain_result` covers the STK codes this server handles, including `0`, `1`, `1032` (customer cancelled), and `1037` (phone timed out), in English and Kiswahili.

## Tests

```bash
npm test
npm run build
```

Tests use a fake HTTP client. They do not call Safaricom. The phrases in `src/agent/evals.ts` must keep producing the same phone, amount, and confirmation behaviour.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). C2B, B2C, balance, and reversal are open product issues, not hidden work inside the STK path.
