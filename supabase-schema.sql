-- ═══════════════════════════════════════════════
-- LISTING LENS — SUPABASE SCHEMA
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- ═══════════════════════════════════════════════

-- ── Users (synced from Clerk) ────────────────────────────────────
-- Clerk is still the auth source. This table mirrors key user data
-- so we can query it alongside reports without hitting the Clerk API.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- Clerk user ID (e.g. user_2x...)
  email TEXT,
  first_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',               -- free | pro | pro_plus
  billing_cycle TEXT,                     -- monthly | annual | null
  credits INTEGER DEFAULT 0,             -- pay-as-you-go credits remaining
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  first_report_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Reports (full report JSON stored here) ───────────────────────
-- This is the core table. Every generated report is stored permanently.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,                    -- Report number (e.g. LL-6TC2)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,                          -- property | vehicle | electronics | general
  score INTEGER,
  verdict TEXT,
  verdict_color TEXT,
  estimated_price TEXT,                   -- display price (e.g. "$1.54M", "¥205M")
  input_type TEXT DEFAULT 'url',          -- url | screenshot | paste | photo
  input_url TEXT,                         -- original listing URL (if provided)
  source_domain TEXT,
  report_data JSONB NOT NULL,             -- full report JSON from Claude
  is_international BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast dashboard queries
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id, created_at DESC);

-- ── Transactions (payment history) ───────────────────────────────
-- Every Stripe payment is logged here for audit and support.

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  product TEXT NOT NULL,                  -- first_report | single_report | pack_5 | pack_10 | pro_monthly | pro_annual | pro_plus_monthly | pro_plus_annual
  amount_cents INTEGER NOT NULL,          -- amount in cents (AUD)
  currency TEXT DEFAULT 'aud',
  status TEXT DEFAULT 'completed',        -- completed | refunded | failed
  report_id TEXT REFERENCES reports(id),  -- linked report (for single purchases)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe ON transactions(stripe_session_id);

-- ── Monthly Usage (track reports per billing period) ─────────────
-- Separate table so we can query/reset usage efficiently.

CREATE TABLE IF NOT EXISTS monthly_usage (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                    -- YYYY-MM format (e.g. "2026-03")
  report_count INTEGER DEFAULT 0,
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_month ON monthly_usage(user_id, month);

-- ── Row Level Security ───────────────────────────────────────────
-- Users can only read their own data.
-- Writes happen server-side (Netlify Functions) using the service role key.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_usage ENABLE ROW LEVEL SECURITY;

-- For Netlify Functions (using service_role key), RLS is bypassed.
-- If you ever add client-side Supabase access, add policies:
--
-- CREATE POLICY "Users read own data" ON users
--   FOR SELECT USING (id = current_setting('request.jwt.claims')::json->>'sub');
--
-- CREATE POLICY "Users read own reports" ON reports
--   FOR SELECT USING (user_id = current_setting('request.jwt.claims')::json->>'sub');

-- ── Helper function: increment monthly usage ─────────────────────

CREATE OR REPLACE FUNCTION increment_monthly_usage(p_user_id TEXT, p_month TEXT)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO monthly_usage (user_id, month, report_count)
  VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month)
  DO UPDATE SET report_count = monthly_usage.report_count + 1
  RETURNING report_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- ── Helper function: get user's remaining credits ────────────────

CREATE OR REPLACE FUNCTION get_remaining_credits(p_user_id TEXT)
RETURNS TABLE(plan TEXT, credits INTEGER, used_this_month INTEGER, plan_limit INTEGER) AS $$
DECLARE
  v_plan TEXT;
  v_credits INTEGER;
  v_used INTEGER;
  v_limit INTEGER;
  v_month TEXT;
BEGIN
  v_month := TO_CHAR(NOW(), 'YYYY-MM');

  SELECT u.plan, u.credits INTO v_plan, v_credits
  FROM users u WHERE u.id = p_user_id;

  SELECT COALESCE(mu.report_count, 0) INTO v_used
  FROM monthly_usage mu
  WHERE mu.user_id = p_user_id AND mu.month = v_month;

  IF v_used IS NULL THEN v_used := 0; END IF;

  v_limit := CASE
    WHEN v_plan = 'pro' THEN 10
    WHEN v_plan = 'pro_plus' THEN 30
    ELSE 0
  END;

  RETURN QUERY SELECT v_plan, v_credits, v_used, v_limit;
END;
$$ LANGUAGE plpgsql;
