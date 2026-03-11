// netlify/functions/generate-report.js
// Listing Lens Report Engine
// Fetches listing URL → sends to Claude → returns structured report JSON

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const { createClient } = require("@supabase/supabase-js");
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { url, text, inputType, userId } = body;

    // Validate we have something to analyse
    if (!url && !text) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Please provide a URL or listing text" }) };
    }

    // Validate user
    if (!userId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Authentication required" }) };
    }

    // ── Verify user has credits ──────────────────────────────────────
    if (!supabase) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Database not configured" }) };
    }

    const hasCredits = await checkAndDeductCredit(userId);
    if (!hasCredits) {
      return {
        statusCode: 402,
        headers,
        body: JSON.stringify({ error: "No credits available. Please purchase credits first." }),
      };
    }

    // ── Step 1: Fetch listing content ─────────────────────────────
    let listingContent = "";
    let sourceDomain = "";

    if (url) {
      try {
        const fetchResponse = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ListingLens/1.0; +https://listinglens.app)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-AU,en;q=0.9",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });

        if (!fetchResponse.ok) {
          // If fetch fails, we can still analyse with just the URL
          listingContent = `[URL provided but page could not be fetched — HTTP ${fetchResponse.status}. Analyse based on URL structure and any available information about this platform.]`;
          sourceDomain = new URL(url).hostname;
        } else {
          const html = await fetchResponse.text();
          // Strip HTML tags, scripts, styles — extract text content
          listingContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 12000); // Limit to ~12k chars for token management
          sourceDomain = new URL(url).hostname;
        }
      } catch (fetchErr) {
        listingContent = `[URL provided but fetch failed: ${fetchErr.message}. Analyse based on URL structure.]`;
        try { sourceDomain = new URL(url).hostname; } catch { sourceDomain = "unknown"; }
      }
    } else if (text) {
      listingContent = text.substring(0, 12000);
      sourceDomain = "user-provided text";
    }

    // ── Step 2: Generate report via Claude ────────────────────────
    const reportNum = "LL-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage(url, listingContent, sourceDomain, inputType, reportNum, today);

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", errText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Report generation failed. Please try again." }),
      };
    }

    const claudeData = await claudeResponse.json();
    const reportText = claudeData.content[0].text;

    // Parse JSON from Claude response
    let report;
    try {
      // Strip any markdown fences if present
      const cleaned = reportText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      report = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw:", reportText.substring(0, 500));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Report format error. Please try again." }),
      };
    }

    // Add metadata
    report.reportNum = reportNum;
    report.date = today;
    report.source = sourceDomain;
    report.url = url || null;
    report.inputType = inputType || "url";
    report.generatedAt = new Date().toISOString();

    // ── Step 3: Store full report in Supabase ──────────────────────
    if (supabase && userId) {
      try {
        // Store full report
        await supabase.from("reports").insert({
          id: reportNum,
          user_id: userId,
          title: report.title,
          category: report.category,
          score: report.score,
          verdict: report.verdict,
          verdict_color: report.verdictColor,
          estimated_price: report.tags?.[0] || "",
          input_type: inputType || "url",
          input_url: url || null,
          source_domain: sourceDomain,
          report_data: report,
          is_international: /[¥€£₹₩]/.test(JSON.stringify(report.tags || [])),
        });
      } catch (dbErr) {
        console.error("Supabase save failed:", dbErr);
        // Non-fatal — report still returns to user
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ report }),
    };

  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};

// ── System Prompt ─────────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are the Listing Lens report engine. You generate structured buyer intelligence reports for any product listing — property, vehicles, electronics, furniture, fashion, or anything else.

Your reports are comprehensive, honest, and actionable. You write like a trusted advisor who has deep expertise in whatever category the listing falls into. You are direct, specific, and never hedge unnecessarily.

CRITICAL RULES:
- Always respond with ONLY a valid JSON object. No markdown, no preamble, no explanation outside the JSON.
- Every flag must have a specific, detailed explanation — not generic advice. Reference actual numbers, specs, or details from the listing.
- The negotiation anchor must be justified with market reasoning, not just a percentage discount.
- Ownership costs must be jurisdiction-specific where possible.
- Questions must be specific to THIS listing, not generic category questions.
- Adapt your scoring dimensions, flag types, and cost sections to the category.

SCORING DIMENSIONS BY CATEGORY:
- Property: Price, Block/Size, Location, Dwelling/Building, Market
- Vehicles: Price, Condition, Reliability, Market, Ownership
- Electronics: Price, Condition, Specs, Timing, Resale
- General/Other: Price, Condition, Value, Market, Seller

VERDICT COLORS:
- Green (#10b981): Solid Buy, Reasonable Buy, Good Value, Fair Price
- Amber (#d97706): High Opportunity, Caution Advised, Mixed Signals, Do Your Homework
- Red (#dc2626): Walk Away, Wait, Overpriced, Too Many Red Flags

FLAG TYPES:
- "red": Serious concerns, deal-breakers, major risks
- "amber": Watch items, things to verify, moderate concerns
- "green": Positive signals, strengths, good signs`;
}

// ── User Message ──────────────────────────────────────────────────
function buildUserMessage(url, content, domain, inputType, reportNum, today) {
  return `Generate a Listing Lens buyer intelligence report for this listing.

INPUT TYPE: ${inputType || "url"}
URL: ${url || "N/A"}
SOURCE: ${domain}
DATE: ${today}

LISTING CONTENT:
${content}

Respond with ONLY a JSON object matching this exact schema:

{
  "title": "Full listing title — address for property, make/model for vehicles, product name for electronics",
  "category": "property|vehicle|electronics|general",
  "tags": ["price", "key spec 1", "key spec 2", "location/seller", "...up to 8 tags"],
  "score": 72,
  "verdict": "Short verdict phrase — 2-5 words",
  "verdictColor": "#10b981 or #d97706 or #dc2626",
  "verdictDesc": "2-3 sentence summary of the overall assessment. Be specific to this listing.",
  "dims": [
    {"v": 7, "l": "Dimension1"},
    {"v": 8, "l": "Dimension2"},
    {"v": 6, "l": "Dimension3"},
    {"v": 7, "l": "Dimension4"},
    {"v": 8, "l": "Dimension5"}
  ],
  "flags": [
    {"t": "red|amber|green", "h": "Flag headline — specific to this listing", "d": "Detailed explanation with numbers and reasoning. 2-4 sentences."},
    ...
  ],
  "neg": {
    "low": "$X or relevant currency",
    "high": "$Y",
    "note": "Negotiation strategy and reasoning. 3-5 sentences. Reference specific leverage points from the listing."
  },
  "total": {
    "label": "True Total Investment or Estimated Annual Costs or similar",
    "amount": "Dollar range",
    "note": "Breakdown explanation. 2-4 sentences.",
    "isRed": false
  },
  "questions": [
    {"c": "Category", "q": "Specific question to ask the seller/agent about THIS listing"},
    ...6-10 questions
  ]
}

IMPORTANT:
- Include 6-10 flags total: mix of red (1-3), amber (2-4), and green (3-5)
- Score out of 100. Each dimension out of 10.
- All monetary values in the listing's local currency. If the listing appears to be in a foreign market relative to Australia, include AUD conversions.
- If you can detect the jurisdiction (state/country), make costs and legal advice jurisdiction-specific.
- If the listing data is thin (e.g. just a URL that couldn't be fetched), do your best with what you have and note limited data in the verdict.`;
}

// ── Check credits and deduct one (atomic) ────────────────────────
async function checkAndDeductCredit(userId) {
  if (!supabase) return false;

  try {
    const thisMonth = new Date().toISOString().substring(0, 7);

    // Get user plan and credits
    const { data: user } = await supabase
      .from("users")
      .select("plan, credits")
      .eq("id", userId)
      .single();

    if (!user) return false;

    const plan = user.plan;
    const limit = plan === "pro" ? 10 : plan === "pro_plus" ? 30 : 0;

    // Check subscription allowance first
    if (plan && limit > 0) {
      const { data: usage } = await supabase
        .from("monthly_usage")
        .select("report_count")
        .eq("user_id", userId)
        .eq("month", thisMonth)
        .single();

      const used = usage?.report_count || 0;
      if (used < limit) {
        // Deduct from subscription allowance
        await supabase.rpc("increment_monthly_usage", {
          p_user_id: userId,
          p_month: thisMonth,
        });
        return true;
      }
    }

    // Check purchased credits
    if (user.credits > 0) {
      await supabase
        .from("users")
        .update({ credits: user.credits - 1, updated_at: new Date().toISOString() })
        .eq("id", userId);
      // Also increment monthly usage for tracking
      await supabase.rpc("increment_monthly_usage", {
        p_user_id: userId,
        p_month: thisMonth,
      });
      return true;
    }

    return false;
  } catch (err) {
    console.error("Credit check failed:", err);
    return false;
  }
}
