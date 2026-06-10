/**
 * OpenSettle webhook handler — Node.js + Express + @opensettle/sdk
 *
 * Run:
 *   npm install
 *   WEBHOOK_SECRET=whsec_… npm start
 *
 * Then trigger a test delivery from the OpenSettle dashboard or via API:
 *   POST /v1/workspaces/:ws/webhook_endpoints/:id/test
 *
 * The verifier uses constant-time HMAC compare + a 5-minute timestamp
 * tolerance. Any tampered byte, replayed delivery, or wrong secret
 * triggers a 400.
 */
import express from "express";
import { verifyWebhook, WebhookVerificationError } from "@opensettle/sdk";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.WEBHOOK_SECRET;

if (!SECRET) {
  console.error("WEBHOOK_SECRET env var required");
  process.exit(1);
}

// CRITICAL: raw body, not JSON-parsed. The HMAC signs the exact bytes
// OpenSettle sent; re-serialised JSON has different whitespace.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const { data } = verifyWebhook<{
      id: string;
      type: string;
      livemode: boolean;
      created_at: string;
      data: Record<string, unknown>;
    }>({
      // express.raw() puts a Buffer on req.body — decode to UTF-8 so the
      // HMAC compare runs on the exact characters OpenSettle signed.
      rawBody: (req.body as Buffer).toString("utf8"),
      signatureHeader: req.header("x-opensettle-signature"),
      secret: SECRET,
      // tolerance: 300, // override default (300s = 5 min) here if needed
    });

    switch (data.type) {
      // Synthetic event emitted by the dashboard's "send test" button and the
      // POST /webhook_endpoints/:id/test API. Same signature path, no business
      // side-effects — handy for confirming the handler is wired up.
      case "webhook.endpoint.test":
        console.log("webhook.endpoint.test", data.id, data.data);
        break;

      // Payments
      case "payment.confirmed":
        // Mark the order paid, grant access, send the receipt, etc.
        console.log("payment.confirmed", data.id, data.data);
        break;
      case "payment.failed":
        console.log("payment.failed", data.id, data.data);
        break;
      case "payment.refunded":
        // Revoke / adjust access.
        console.log("payment.refunded", data.id, data.data);
        break;
      case "payment.reorg_suspected":
        // Early-warning signal: the original block hash for a confirmed
        // payment no longer matches the canonical chain. Status is still
        // `confirmed` — wait for `payment.reorged` (deep reorg confirmed)
        // or no further event (chain re-included the block).
        console.log("payment.reorg_suspected", data.id, data.data);
        break;
      case "payment.reorged":
        // Deep reorg confirmed by an OpenSettle operator. Payment status
        // is now `reorged`. Decide your refund / fulfilment-rollback
        // policy. data.data.metadata includes `reorgedAt` + optional
        // `reorgReason`.
        console.log("payment.reorged", data.id, data.data);
        break;
      case "payment.reversed":
        // Authoritative on-chain rollback — the reorg-afterglow sweep confirmed
        // the settlement is no longer on the canonical chain (fires alongside /
        // instead of `payment.reorged`). If you already shipped goods or granted
        // access for this payment, THIS is your trigger to recover: de-provision,
        // cancel the order, claw back.
        console.log("payment.reversed", data.id, data.data);
        break;

      // Subscriptions — `subscription.created` and `subscription.canceled`
      // carry the full subscription object on `data.data.subscription`
      // (`canceled` adds `data.data.reason`). `subscription.renewed` ships an
      // additive superset: `{ subscription, invoice, subscriptionId,
      // nextBillingDate, metadata }` — prefer `subscription` + `invoice`, the
      // flat fields remain for compatibility. `trial_ended` / `past_due` carry
      // a minimal `{ subscriptionId, metadata }`. The `metadata` you stashed on
      // the checkout rides along on every event, so no database lookup needed.
      case "subscription.created":
        console.log("subscription.created", data.id, data.data);
        break;
      case "subscription.trial_ended":
        console.log("subscription.trial_ended", data.id, data.data);
        break;
      case "subscription.renewed":
        console.log("subscription.renewed", data.id, data.data);
        break;
      case "subscription.past_due":
        console.log("subscription.past_due", data.id, data.data);
        break;
      case "subscription.canceled":
        console.log("subscription.canceled", data.id, data.data);
        break;

      // Invoices
      case "invoice.paid":
        console.log("invoice.paid", data.id, data.data);
        break;
      case "invoice.past_due":
        console.log("invoice.past_due", data.id, data.data);
        break;

      default:
        // Unknown event type — return 200 anyway so OpenSettle doesn't
        // retry. New event types are added over time; reject here only
        // if you specifically want unknown types to be retried.
        console.log("unhandled event", data.type);
    }

    res.status(200).end();
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      // err.reason: "missing_header" | "malformed_header"
      //           | "stale_timestamp" | "signature_mismatch"
      //           | "invalid_body"
      console.error("webhook verification failed:", err.reason);
      return res.status(400).end(err.reason);
    }
    console.error("webhook handler error:", err);
    res.status(500).end();
  }
});

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Webhook handler listening on :${PORT}/webhook`);
});
