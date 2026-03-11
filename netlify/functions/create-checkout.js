// netlify/functions/create-checkout.js
// Creates a Stripe Checkout session — uses Supabase for user/credit checks

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");

const SITE_URL = process.env.URL || "https://listinglens.app";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const PRICES = {
  first_report: process.env.STRIPE_PRICE_FIRST_REPORT,
  single_report: process.env.STRIPE_PRICE_SINGLE_REPORT,
  pack_5: process.env.STRIPE_PRICE_PACK_5,
  pack_10: process.env.STRIPE_PRICE_PACK_10,
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  pro_plus_monthly: process.env.STRIPE_PRICE_PROPLUS_MONTHLY,
  pro_plus_annual: process.env.STRIPE_PRICE_PROPLUS_ANNUAL,
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const body = JSON.parse(event.body);
    const { product, userId } = body;

    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: "Authentication required" }) };
    if (!product) return { statusCode: 400, headers, body: JSON.stringify({ error: "Product type required" }) };

    // ── Ensure user exists in Supabase ──────────────────────────────
    await supabase.from("users").upsert(
      { id: userId, updated_at: new Date().toISOString() },
      { onConflict: "id", ignoreDuplicates: true }
    );

    // ── Determine price ─────────────────────────────────────────────
    let priceId;
    let mode = "payment";

    switch (product) {
      case "first_report":
        priceId = PRICES.first_report;
        break;
      case "single_report":
        priceId = PRICES.single_report;
        break;
      case "pack_5": priceId = PRICES.pack_5; break;
      case "pack_10": priceId = PRICES.pack_10; break;
      case "pro_monthly": priceId = PRICES.pro_monthly; mode = "subscription"; break;
      case "pro_annual": priceId = PRICES.pro_annual; mode = "subscription"; break;
      case "pro_plus_monthly": priceId = PRICES.pro_plus_monthly; mode = "subscription"; break;
      case "pro_plus_annual": priceId = PRICES.pro_plus_annual; mode = "subscription"; break;
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid product" }) };
    }

    if (!priceId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Price not configured." }) };
    }

    // ── Create Checkout Session ─────────────────────────────────────
    const sessionParams = {
      mode,
      success_url: SITE_URL + "/dashboard?purchased=" + product,
      cancel_url: SITE_URL + "/dashboard",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, product },
    };
    if (mode === "subscription") sessionParams.allow_promotion_codes = true;
    if (mode === "payment") {
      sessionParams.payment_intent_data = {
        metadata: { userId, product },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, sessionId: session.id }) };

  } catch (err) {
    console.error("Checkout error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create checkout." }) };
  }
};

