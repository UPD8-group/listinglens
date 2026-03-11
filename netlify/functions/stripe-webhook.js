// netlify/functions/stripe-webhook.js
// Processes Stripe events — updates Supabase with plan/credits/transactions

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let stripeEvent;
  try {
    const sig = event.headers["stripe-signature"];
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return { statusCode: 400, body: "Webhook Error: " + err.message };
  }

  try {
    switch (stripeEvent.type) {

      // ── One-time or subscription payment completed ────────────
      case "checkout.session.completed": {
        const session = stripeEvent.data.object;
        if (session.payment_status !== "paid") break;

        const userId = session.metadata?.userId;
        const product = session.metadata?.product;
        if (!userId) break;

        // Log transaction
        await supabase.from("transactions").insert({
          user_id: userId,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent || null,
          product: product,
          amount_cents: session.amount_total || 0,
          currency: session.currency || "aud",
          status: "completed",
        });

        if (session.mode === "payment") {
          await handleOneTimePayment(userId, product, session);
        } else if (session.mode === "subscription") {
          await handleSubscription(userId, product, session);
        }
        break;
      }

      // ── Subscription renewed ──────────────────────────────────
      case "invoice.paid": {
        const invoice = stripeEvent.data.object;
        if (invoice.billing_reason === "subscription_cycle") {
          const subId = invoice.subscription;
          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = sub.metadata?.userId;
          if (userId) {
            // Reset monthly usage for new billing period
            const thisMonth = new Date().toISOString().substring(0, 7);
            await supabase.from("monthly_usage").upsert(
              { user_id: userId, month: thisMonth, report_count: 0 },
              { onConflict: "user_id,month" }
            );
          }
        }
        break;
      }

      // ── Subscription cancelled ────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = stripeEvent.data.object;
        const userId = sub.metadata?.userId;
        if (userId) {
          await supabase.from("users").update({
            plan: "free",
            billing_cycle: null,
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          }).eq("id", userId);
        }
        break;
      }

      // ── Subscription updated (upgrade/downgrade) ──────────────
      case "customer.subscription.updated": {
        const sub = stripeEvent.data.object;
        const userId = sub.metadata?.userId;
        if (userId && sub.status === "active") {
          const priceId = sub.items.data[0]?.price?.id;
          const plan = getPlanFromPrice(priceId);
          if (plan) {
            await supabase.from("users").update({
              plan: plan,
              updated_at: new Date().toISOString(),
            }).eq("id", userId);
          }
        }
        break;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error("Webhook handler error:", err);
    return { statusCode: 500, body: "Internal error" };
  }
};

// ── Handle one-time payment ──────────────────────────────────────
async function handleOneTimePayment(userId, product, session) {
  // Get current credits
  const { data: user } = await supabase.from("users").select("credits").eq("id", userId).single();
  const currentCredits = user?.credits || 0;

  switch (product) {
    case "first_report":
      // Add 2 credits for $1 (intro offer)
      await supabase.from("users").update({
        credits: currentCredits + 2,
        first_report_used: true,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      break;

    case "single_report":
      // Add 1 credit
      await supabase.from("users").update({
        credits: currentCredits + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      break;

    case "pack_5":
      await supabase.from("users").update({
        credits: currentCredits + 5,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      break;

    case "pack_10":
      await supabase.from("users").update({
        credits: currentCredits + 10,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      break;
  }
}

// ── Handle subscription created ──────────────────────────────────
async function handleSubscription(userId, product, session) {
  const plan = product.includes("pro_plus") ? "pro_plus" : "pro";
  const cycle = product.includes("annual") ? "annual" : "monthly";

  await supabase.from("users").update({
    plan: plan,
    billing_cycle: cycle,
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: session.subscription || null,
    updated_at: new Date().toISOString(),
  }).eq("id", userId);

  // Save userId in Stripe subscription metadata for future webhook lookups
  if (session.subscription) {
    await stripe.subscriptions.update(session.subscription, {
      metadata: { userId },
    });
  }
}

// ── Determine plan from Stripe price ID ──────────────────────────
function getPlanFromPrice(priceId) {
  const env = process.env;
  if (priceId === env.STRIPE_PRICE_PRO_MONTHLY || priceId === env.STRIPE_PRICE_PRO_ANNUAL) return "pro";
  if (priceId === env.STRIPE_PRICE_PROPLUS_MONTHLY || priceId === env.STRIPE_PRICE_PROPLUS_ANNUAL) return "pro_plus";
  return null;
}
