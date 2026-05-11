# opensettle-webhook-examples

Drop-in webhook handlers for the [OpenSettle](https://opensettle.io) API.
Each example shows how to verify the HMAC-SHA256 signature, parse the
event, and respond — in the language of your stack.

## Why verification matters

Webhooks land at a public URL on your server. Without signature
verification, anyone who guesses the URL can pretend to be OpenSettle
and trigger your business logic (mark orders paid, grant subscriptions,
emit refunds). Constant-time HMAC verification + a signed timestamp is
the only reliable defense.

This repo is a copy-paste reference for getting that right.

## Examples

| Language | Path | Notes |
|---|---|---|
| Node.js (TypeScript) | [`node/`](./node) | Uses `@opensettle/sdk` — idiomatic, fewer lines |
| Node.js (no SDK) | [`node-no-sdk/`](./node-no-sdk) | Zero-dependency. Read the math, copy into your codebase, never look at it again |

Python, PHP, and Go ports will land here when they exist — the file
listing above is the source of truth.

## Signature format

Every OpenSettle webhook ships with an `x-opensettle-signature` header:

```
x-opensettle-signature: t=1714680000,v1=4d2b6a7c2f8a…ee0c
```

Where:
- `t` — unix timestamp of when OpenSettle signed the payload
- `v1` — hex-encoded HMAC-SHA256 of `${t}.${rawBody}` using your endpoint's signing secret

Verifiers MUST:
1. Compare the HMAC in **constant time** (don't use string equality —
   it leaks bytes via timing).
2. Reject deliveries with stale timestamps (default tolerance: 5
   minutes). This stops replay attacks even if an attacker captured a
   valid signed payload.
3. Operate on the **raw body bytes**, not parsed JSON. Re-serializing
   parsed JSON changes whitespace and breaks the signature.

All examples in this repo do all three.

## Common gotcha: raw body

Most web frameworks JSON-parse request bodies before your handler runs.
That destroys the original bytes and breaks signature verification.
Configure raw-body access on the webhook route only:

```ts
// Express
app.use("/webhook", express.raw({ type: "application/json" }));
```

The Node examples in this repo use the snippet above. When ports for
other frameworks land, each will document its own raw-body incantation.

## Webhook events you'll receive

| Event | When OpenSettle emits it | Acceptable handler action |
|---|---|---|
| `payment.confirmed` | On-chain payment reached the configured confirmation threshold | Mark the order paid, fulfil it, send a receipt |
| `payment.failed` | A pending checkout / payment timed out or the chain reverted | Notify the buyer, offer a retry |
| `payment.refunded` | Refund tx confirmed on-chain | Revoke / adjust access |
| `payment.reorg_suspected` | Reorg-afterglow sweep detected the original block hash for a confirmed payment no longer matches the canonical chain. **Status is still `confirmed`** — this is an early-warning signal, not a state change | Mark the order under-review in your dashboard. Wait for the follow-up: either a `payment.reorged` (deep reorg confirmed) or no further event (chain re-included the block; resume normal processing) |
| `payment.reorged` | An OpenSettle operator has confirmed the deep reorg and flipped the payment to `status: "reorged"`. The original tx is gone from the canonical chain | Decide your refund / fulfilment-rollback policy. The payment.metadata includes `reorgedAt` and an optional `reorgReason` |
| `subscription.created` | New subscription activated. `data.subscription` is the full record | Activate access, store the subscription id |
| `subscription.trial_ended` | Trial finished and the first paid period started | No-op for most apps; useful for analytics |
| `subscription.renewed` | Recurring period renewed. `data.nextBillingDate` is set | Extend access through the new period |
| `subscription.past_due` | Renewal payment failed; dunning started | Optional: warn the customer |
| `subscription.canceled` | Subscription cancelled. `data.reason` is set when known | Revoke access (or schedule revocation if you cancel at period end) |
| `invoice.paid` | An invoice transitioned to paid | Issue receipt / unlock invoiced goods |
| `invoice.past_due` | An invoice's due date passed without payment | Optional: collections / dunning |

The lifecycle events (`subscription.trial_ended`, `subscription.renewed`,
`subscription.past_due`, `subscription.canceled`) carry a minimal payload
of `{ subscriptionId, [nextBillingDate], [reason], metadata }`. Stash any
identifiers you'll want to recover (your own `userId`, `planId`, …) in
the checkout's `metadata` — OpenSettle copies it to the subscription and
includes it on every lifecycle event, so you don't need a DB lookup.

## Testing locally

After deploying your handler, trigger a test delivery from the
dashboard's Webhooks tab, or via the API:

```bash
curl -X POST \
  -H "Authorization: Bearer $OPENSETTLE_KEY" \
  https://api.opensettle.io/v1/workspaces/$WS/webhook_endpoints/$ENDPOINT_ID/test
```

You'll get a synthetic `payment.confirmed` event delivered with a real
signature. Use it to verify the handler before any real traffic hits.

## License

[MIT](./LICENSE) — copy any of these examples directly into your codebase.

## Security

If you find a bug in the verification logic, please don't open a public
issue — report via [opensettle.io/security](https://opensettle.io/security)
or [opensettle@proton.me](mailto:opensettle@proton.me).
