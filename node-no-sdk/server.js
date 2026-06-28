// OpenSettle webhook handler — Node.js + Express, zero SDK dependency.
//
// Same wire-format verification as @opensettle/sdk. Read the math, copy it
// into your own codebase, audit it once, never look at it again.
//
// Run:
//   npm install
//   WEBHOOK_SECRET=whsec_… npm start
//
// Trigger a test delivery from the OpenSettle dashboard or via API:
//   POST /v1/workspaces/:ws/webhook_endpoints/:id/test

import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300; // 5 minutes; reject older deliveries

if (!SECRET) {
  console.error("WEBHOOK_SECRET env var required");
  process.exit(1);
}

/**
 * Parse `t=…,v1=…` header into { timestamp, signature }.
 * Returns null if the header is missing or malformed.
 */
function parseSignatureHeader(header) {
  if (!header || typeof header !== "string") return null;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.trim().split("=");
      return [k, v];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) return null;
  return { timestamp: t, signature: v1 };
}

/**
 * Constant-time HMAC verification. Returns true if the signature on
 * `${timestamp}.${rawBody}` matches what we'd compute with our secret.
 */
function verifyHmac(rawBody, timestamp, expectedHex, secret) {
  const computed = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  let expected;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

// CRITICAL: raw body, not JSON-parsed. The HMAC signs the exact bytes
// OpenSettle sent; re-serialised JSON has different whitespace.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const parsed = parseSignatureHeader(req.header("x-opensettle-signature"));
  if (!parsed) {
    return res.status(400).end("missing_or_malformed_header");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > TOLERANCE_SECONDS) {
    return res.status(400).end("stale_timestamp");
  }

  // req.body is a Buffer when express.raw() is configured.
  const rawBody = req.body.toString("utf8");
  if (!verifyHmac(rawBody, parsed.timestamp, parsed.signature, SECRET)) {
    return res.status(400).end("signature_mismatch");
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).end("invalid_body");
  }

  switch (event.type) {
    // Synthetic event emitted by the dashboard's "send test" button and the
    // POST /webhook_endpoints/:id/test API. Same signature path, no business
    // side-effects — handy for confirming the handler is wired up.
    case "webhook.endpoint.test":
      console.log("webhook.endpoint.test", event.id, event.data);
      break;

    // Payments
    case "payment.confirmed":
      console.log("payment.confirmed", event.id, event.data);
      break;
    case "payment.failed":
      console.log("payment.failed", event.id, event.data);
      break;
    case "payment.refunded":
      console.log("payment.refunded", event.id, event.data);
      break;
    case "payment.reorg_suspected":
      // Early-warning signal: status is still `confirmed`. Wait for
      // payment.reorged or no further event.
      console.log("payment.reorg_suspected", event.id, event.data);
      break;
    case "payment.reorged":
      // Deep reorg confirmed by an OpenSettle operator.
      console.log("payment.reorged", event.id, event.data);
      break;
    case "payment.reversed":
      // Authoritative on-chain rollback — settlement is no longer on the
      // canonical chain (fires alongside / instead of payment.reorged). If you
      // already fulfilled this payment, de-provision / cancel / claw back here.
      console.log("payment.reversed", event.id, event.data);
      break;

    // Subscriptions
    case "subscription.created":
      console.log("subscription.created", event.id, event.data);
      break;
    case "subscription.trial_ended":
      console.log("subscription.trial_ended", event.id, event.data);
      break;
    case "subscription.renewed":
      console.log("subscription.renewed", event.id, event.data);
      break;
    case "subscription.past_due":
      console.log("subscription.past_due", event.id, event.data);
      break;
    case "subscription.canceled":
      console.log("subscription.canceled", event.id, event.data);
      break;

    // Invoices
    case "invoice.paid":
      console.log("invoice.paid", event.id, event.data);
      break;
    case "invoice.past_due":
      console.log("invoice.past_due", event.id, event.data);
      break;

    // Affiliate commissions (non-custodial ledger — no funds move through
    // OpenSettle). `accrued` = a partner commission recorded on a settled,
    // affiliate-attributed sale; `adjusted` = reduced after a partial refund;
    // `paid` = the merchant marked it paid out; `voided` = canceled after a
    // full refund or reorg.
    case "commission.accrued":
      console.log("commission.accrued", event.id, event.data);
      break;
    case "commission.adjusted":
      console.log("commission.adjusted", event.id, event.data);
      break;
    case "commission.paid":
      console.log("commission.paid", event.id, event.data);
      break;
    case "commission.voided":
      console.log("commission.voided", event.id, event.data);
      break;

    default:
      // Unknown event type — return 200 anyway so OpenSettle doesn't
      // retry. New event types are added over time.
      console.log("unhandled event", event.type);
  }

  res.status(200).end();
});

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Webhook handler (no-sdk) listening on :${PORT}/webhook`);
});
