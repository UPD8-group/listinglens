// netlify/functions/get-report.js
// Fetches a single report by ID for a user — server-side (bypasses RLS)

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
    const { userId, reportId } = JSON.parse(event.body);
    if (!userId || !reportId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing userId or reportId" }) };
    if (!supabase) return { statusCode: 500, headers, body: JSON.stringify({ error: "Database not configured" }) };

    const { data, error } = await supabase
      .from("reports")
      .select("report_data")
      .eq("id", reportId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Report not found" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ report: data.report_data }) };

  } catch (err) {
    console.error("Get report error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to load report" }) };
  }
};
