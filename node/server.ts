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
      data: Record<string, unknown>;
      created: string;
    }>({
      rawBody: req.body, // Buffer when express.raw() is in use
      signatureHeader: req.header("x-opensettle-signature"),
      secret: SECRET,
      // tolerance: 300, // override default (300s = 5 min) here if needed
    });

    switch (data.type) {
      case "payment.confirmed":
        // Mark the order paid, grant access, send the receipt, etc.
        console.log("payment.confirmed", data.id, data.data);
        break;
      case "subscription.renewed":
        console.log("subscription.renewed", data.id, data.data);
        break;
      case "subscription.past_due":
        console.log("subscription.past_due", data.id, data.data);
        break;
      case "invoice.paid":
        console.log("invoice.paid", data.id, data.data);
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
