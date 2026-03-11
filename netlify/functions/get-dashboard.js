// netlify/functions/get-dashboard.js
// Fetches dashboard data for a user — server-side (bypasses RLS)

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { userId } = JSON.parse(event.body);
    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: "Authentication required" }) };
    if (!supabase) return { statusCode: 500, headers, body: JSON.stringify({ error: "Database not configured" }) };

    // Fetch user
    const { data: user } = await supabase
      .from("users")
      .select("plan, credits, first_report_used")
      .eq("id", userId)
      .single();

    // Fetch reports (most recent 20)
    const { data: reports } = await supabase
      .from("reports")
      .select("id, title, category, score, verdict, verdict_color, estimated_price, is_international, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    // Fetch monthly usage
    const thisMonth = new Date().toISOString().substring(0, 7);
    const { data: usage } = await supabase
      .from("monthly_usage")
      .select("report_count")
      .eq("user_id", userId)
      .eq("month", thisMonth)
      .single();

    // Count red flags from actual report data
    let totalFlags = 0;
    if (reports && reports.length > 0) {
      const { data: fullReports } = await supabase
        .from("reports")
        .select("report_data")
        .eq("user_id", userId)
        .limit(20);

      if (fullReports) {
        for (const fr of fullReports) {
          const flags = fr.report_data?.flags || [];
          totalFlags += flags.filter(f => f.t === "red").length;
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        user: user || { plan: "free", credits: 0, first_report_used: false },
        reports: reports || [],
        usage: usage?.report_count || 0,
        redFlags: totalFlags,
      }),
    };

  } catch (err) {
    console.error("Dashboard data error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to load dashboard data" }) };
  }
};
