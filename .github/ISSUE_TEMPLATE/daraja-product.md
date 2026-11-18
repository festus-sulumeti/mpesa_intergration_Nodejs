---
name: Daraja product
about: Add another Daraja API to the client, the reference server, and the agent tools
title: "Add Daraja product: "
labels: enhancement
---

## Product

- [ ] C2B validation and confirmation
- [ ] B2C payment
- [ ] Account balance
- [ ] Transaction reversal
- [ ] Result-code text, if this product uses codes that are not in `src/daraja/result-codes.ts`

## Done when

- [ ] The client method takes config from the environment and returns a typed result
- [ ] Secrets, access tokens, and passkeys are not logged or returned
- [ ] A tool wraps the method and follows the confirmation rule if it moves money
- [ ] English and Kiswahili text is included for new result codes
- [ ] Tests use a fake HTTP client. CI must not call Safaricom
