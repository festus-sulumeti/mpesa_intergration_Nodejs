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
pnpm install
cp .env.example .env
pnpm test
pnpm start
```

`pnpm start` watches `src/server.ts`. `pnpm build` then `pnpm serve` runs the compiled server. The default port is `5001`.

Set `MPESA_API_KEY` before starting the server. `POST /stk`, `POST /agent`, `POST /b2c`, `POST /reversal`, `POST /balance`, `POST /c2b/register`, and the transaction reads require that key in the `x-api-key` header or as `Authorization: Bearer`. Daraja callbacks stay open and only update a checkout or conversation this server created.

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
| `POST` | `/stk` | STK push. Requires the API key and `confirm: true` |
| `POST` | `/callback` | Daraja STK callback. Updates a checkout this server created |
| `GET` | `/stk/:checkoutRequestId` | Query Daraja and update a pending ledger row |
| `GET` | `/transactions` | Ledger, newest first. Requires the API key |
| `POST` | `/agent` | `{ "message": "Send KES 500 to 0712345678 for January chama" }` |
| `POST` | `/c2b/register` | Register validation and confirmation URLs. Requires `confirm: true` |
| `POST` | `/c2b/validation` | Open to Daraja. Accepts a well-formed paybill check |
| `POST` | `/c2b/confirmation` | Open to Daraja. Stores the payment once per `TransID` |
| `POST` | `/b2c` | Payout. Requires the API key and `confirm: true` |
| `POST` | `/balance` | Account balance request. The figure arrives on `/balance/result` |
| `POST` | `/reversal` | Reverse a receipt. Requires the API key and `confirm: true` |
| `POST` | `/ussd` | Africa's Talking session. Asks for an amount, then sends the STK push |

`AccountReference` is at most 12 letters or digits. `TransactionDesc` is at most 13 characters. A missing confirmation returns `409` and does not call Daraja. A missing API key returns `401`.

The ledger is SQLite at `data/daraja.sqlite` unless `MPESA_DB_PATH` is set. It stores the idempotency key, checkout id, receipt, result code, and a masked phone alongside the full number. If a callback has not arrived after `MPESA_QUERY_AFTER_MS` (default 30 seconds), the server queries Daraja. Result code `4999` stays pending.

## Africa's Talking

SMS and USSD sit beside Daraja. They do not collect the money. Set `AT_USERNAME` and `AT_API_KEY` to turn them on. Leave them blank and the server stays Daraja-only.

When a ledger row first becomes successful, the server sends `Confirmed. KES 500. Receipt RCPT1.` to that phone. A repeated callback does not send a second SMS. The Africa's Talking key is not written into the ledger or the Daraja request.

`POST /ussd` is the Africa's Talking callback. The first screen asks for the amount. The next screen sends the STK push to the handset that opened the session. Point the Africa's Talking USSD product at `https://<your-tunnel>/ussd`. USSD needs a short code from Africa's Talking. Sandbox SMS does not.

## Sandbox payment

Use the sandbox test MSISDN from the Daraja portal. The usual one is `254708374149`.

```bash
cloudflared tunnel --url http://localhost:5001
# set MPESA_CALLBACK_URL=https://<host>.trycloudflare.com/callback
pnpm start
```

```bash
curl -sS -X POST http://127.0.0.1:5001/stk \
  -H 'content-type: application/json' \
  -H 'x-api-key: choose-a-long-random-string' \
  -d '{"phone":"254708374149","amount":1,"accountReference":"SANDBOX","transactionDesc":"One shilling","confirm":true}'
```

Approve the prompt on the phone. Daraja then calls `POST /callback`. Read the ledger and look for the receipt:

```bash
curl -sS http://127.0.0.1:5001/transactions \
  -H 'x-api-key: choose-a-long-random-string'
```

If the row is still pending after the callback window, the server queries Daraja on its own.

## Install the client

This repository's package name is `mpesa-daraja`. Build it, then publish when you are ready:

```bash
pnpm build
pnpm publish --access public
```

Another app can then depend on the library without taking the reference server:

```bash
pnpm add mpesa-daraja
```

```ts
import { createDarajaClient, createSqliteStore, loadConfig } from "mpesa-daraja";

const daraja = createDarajaClient(loadConfig());
const ledger = createSqliteStore("data/daraja.sqlite");
```

## Agent

Without `AGENT_API_KEY`, a built-in planner handles a fixed set of English and Kiswahili phrases. With an OpenAI-compatible key, the model may choose tools, but it still cannot set `confirm`. Only the caller can.

```bash
pnpm agent -- "Nitumie stk ya mia tano kwa 0712345678"
pnpm agent -- --confirm "Send KES 500 to 0712345678 for January chama"
```

The first command prints a confirmation in English and Kiswahili. The second sends the prompt only when `.env` is filled in.

Examples, all safe to run with no credentials:

```bash
pnpm example:chama
pnpm example:school
pnpm example:till
pnpm example:subscription
```

Add `--confirm` to send a sandbox push. The subscription example uses a monthly idempotency key so the same month is not charged twice. The till example uses `CustomerBuyGoodsOnline`.

## MCP

`pnpm mcp` speaks MCP over stdin and stdout. Point a coding agent at it:

```json
{
  "mcpServers": {
    "daraja": {
      "command": "pnpm",
      "args": ["mcp"],
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
pnpm test
pnpm build
```

Tests use a fake HTTP client. They do not call Safaricom. The phrases in `src/agent/evals.ts` must keep producing the same phone, amount, and confirmation behaviour.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). C2B, B2C, balance, and reversal are open product issues, not hidden work inside the STK path.
