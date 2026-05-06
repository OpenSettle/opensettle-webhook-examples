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

| Language | Path | Status |
|---|---|---|
| Node.js (TypeScript) | [`node/`](./node) | ✅ Complete, uses `@opensettle/sdk` |
| Node.js (no SDK) | [`node-no-sdk/`](./node-no-sdk) | ✅ Complete, no dependency |
| Python | [`python/`](./python) | 🚧 Coming next |
| PHP | [`php/`](./php) | 🚧 Coming next |
| Go | [`go/`](./go) | 🚧 Coming next |

The two Node examples cover the common cases: with the official SDK
(idiomatic, fewer lines) and without (zero-dependency, useful when you
want to see exactly what's happening on the wire).

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

```python
# Flask
@app.route("/webhook", methods=["POST"])
def webhook():
    raw = request.get_data()  # bytes; not request.json
    ...
```

Each example includes its own framework's incantation for this.

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
