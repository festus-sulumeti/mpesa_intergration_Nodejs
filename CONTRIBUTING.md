# Contributing

Run `npm install`, copy `.env.example` to `.env` only on your machine, then `npm test`.

CI runs `npm test` and `npm run build`. Do not put Daraja keys in the workflow, the tests, or the git history. A new Daraja call needs a fake HTTP response in the test, not a live sandbox request.

To add a product such as C2B, B2C, balance, or reversal:

1. Add a typed method on the client in `src/daraja`.
2. Read settings from `loadConfig`. Do not add a new place to hard-code a secret.
3. Wrap money movement in a tool that requires `confirm=true` and an idempotency key.
4. Add English and Kiswahili copy for any new result code.
5. Keep phone normalization on `normalizeKenyanPhone`. Do not prefix `254` onto a number that already has it.

The agent planner in `src/agent/plan.ts` is intentionally small. If you add a phrase, add the expected tool call to `src/agent/evals.ts` and a test assertion.
