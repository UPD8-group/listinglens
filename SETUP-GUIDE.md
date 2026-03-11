# Listing Lens — Setup Guide

## Repository Structure

```
listinglens.app/
├── index.html                        ← Landing page (with Clerk auth modal)
├── dashboard.html                    ← Post-login dashboard
├── report.html                       ← Report viewer (generates + displays reports)
├── pricing.html                      ← Pricing page (to build next)
├── privacy.html                      ← Privacy policy (to build next)
├── terms.html                        ← Terms of service (to build next)
├── netlify.toml                      ← Netlify routing + headers
└── netlify/
    └── functions/
        └── generate-report.js        ← Report engine (URL fetch + Claude API)
```

## Environment Variables (Netlify)

Set these in **Netlify → Site settings → Environment variables**:

| Variable | Value | Where to get it |
|---|---|---|
| `CLAUDE_API_KEY` | `sk-ant-...` | console.anthropic.com → API Keys |
| `CLERK_SECRET_KEY` | `sk_live_...` | clerk.com → Your app → API Keys |
| `STRIPE_SECRET_KEY` | `sk_live_...` | dashboard.stripe.com → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | dashboard.stripe.com → Developers → Webhooks |
| `SUPABASE_URL` | `https://xxx.supabase.co` | supabase.com → Your project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | supabase.com → Your project → Settings → API (service_role, secret) |
| `STRIPE_PRICE_FIRST_REPORT` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_SINGLE_REPORT` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PACK_5` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PACK_10` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PRO_ANNUAL` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PROPLUS_MONTHLY` | `price_...` | Created in Stripe (see below) |
| `STRIPE_PRICE_PROPLUS_ANNUAL` | `price_...` | Created in Stripe (see below) |

## Stripe Setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) (UPD8 Group account)
2. Create **Products** in Stripe Dashboard → Product Catalog:

| Product | Price | Type | Stripe product name |
|---|---|---|---|
| First Report | $1.00 AUD | One-time | Listing Lens — Starter (2 reports) |
| Single Report | $4.99 AUD | One-time | Listing Lens — Single Report |
| 5-Pack | $19.99 AUD | One-time | Listing Lens — 5 Report Pack |
| 10-Pack | $34.99 AUD | One-time | Listing Lens — 10 Report Pack |
| Pro Monthly | $9.00 AUD | Recurring (monthly) | Listing Lens — Pro Monthly |
| Pro Annual | $79.00 AUD | Recurring (yearly) | Listing Lens — Pro Annual |
| Pro+ Monthly | $19.00 AUD | Recurring (monthly) | Listing Lens — Pro+ Monthly |
| Pro+ Annual | $159.00 AUD | Recurring (yearly) | Listing Lens — Pro+ Annual |

3. Copy each **Price ID** (`price_xxx`) into the environment variables above
4. Set up **Webhook**:
   - URL: `https://listinglens.app/.netlify/functions/stripe-webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `invoice.paid`
     - `customer.subscription.deleted`
     - `customer.subscription.updated`
   - Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET` env var

## Payment Flow

```
User pastes URL → clicks Analyse
        ↓
create-checkout function:
  ├── Has subscription credits? → skip payment, generate directly
  ├── First purchase ever? → $1 for 2 credits
  └── Otherwise → $4.99 for 1 credit (or packs/subscriptions)
        ↓
Stripe Checkout (handles currency, Apple Pay, Google Pay)
        ↓
Success redirect → /report.html?session_id=xxx&url=xxx
        ↓
generate-report function:
  ├── Verify Stripe session is paid
  ├── Fetch listing URL content
  ├── Send to Claude API with report prompt
  ├── Save summary to Clerk user metadata
  └── Return full report JSON
        ↓
Report page renders JSON into newspaper-style template
        ↓
Report cached in localStorage for instant re-access
```

### Stripe handles:
- Currency detection (defaults AUD, shows local currency to international users)
- Apple Pay / Google Pay
- Card payments
- Tax collection (if enabled)
- Subscription billing and renewals

## Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a project called "Listing Lens"
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql` — this creates all tables, indexes, RLS policies, and helper functions
3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL` env var
   - **service_role key** (secret) → `SUPABASE_SERVICE_ROLE_KEY` env var
   - **anon key** (public) → paste into `dashboard.html` (line ~316, `SUPABASE_ANON_KEY`)
4. The anon key goes in the frontend (read-only via RLS). The service_role key goes in env vars only (full access, server-side).

### Database Tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Synced from Clerk | id, plan, credits, stripe IDs |
| `reports` | Full report JSON stored permanently | user_id, report_data (JSONB), score, verdict |
| `transactions` | Every Stripe payment logged | stripe_session_id, product, amount |
| `monthly_usage` | Tracks reports per billing month | user_id, month, report_count |

### Data Flow
- **Clerk** = auth source (who is this person?)
- **Supabase** = data store (what have they done?)
- **Stripe** = payment processor (have they paid?)

## Clerk Setup

1. Go to [clerk.com](https://clerk.com) and create a project called "Listing Lens"
2. Enable **Apple** and **Google** as social connections (Settings → Social connections)
3. Enable **Email** as an authentication method
4. In your Clerk dashboard, set these URLs:
   - **Home URL**: `https://listinglens.app`
   - **Sign-in URL**: `https://listinglens.app` (modal handles it)
   - **After sign-in URL**: `https://listinglens.app/dashboard`
   - **After sign-up URL**: `https://listinglens.app/dashboard`
5. Copy your **Publishable key** (`pk_live_...`)
6. Replace `pk_test_REPLACE_ME` in these files:
   - `index.html` (line ~30)
   - `dashboard.html` (line ~12)
   - `report.html` (line ~12)

## Deploy to Netlify

1. Push all files to your GitHub repo (`listinglens-app` or similar)
2. In Netlify:
   - Connect the repo
   - Build command: (leave blank — static site)
   - Publish directory: `.`
   - Set environment variables (above)
3. Custom domain: `listinglens.app`

## How It Works

### Flow
1. User lands on `index.html` → clicks "Create Account" → Clerk modal opens
2. Signs up via Apple/Google/Email → Clerk redirects to `/dashboard`
3. Dashboard checks Clerk auth → shows empty state for new users
4. User pastes URL → clicks "Analyse" → redirects to `/report?url=...`
5. Report page calls `/.netlify/functions/generate-report` with:
   - The listing URL
   - User's Clerk ID (for tracking)
6. Netlify function:
   - Fetches the listing page content
   - Sends it to Claude API with the report prompt
   - Receives structured JSON back
   - Saves report summary to Clerk user metadata
   - Returns full report JSON to frontend
7. Report page renders the JSON into the newspaper-style template
8. Report is cached in localStorage for offline access

### Report Storage
- **Full reports** → stored permanently in Supabase `reports` table as JSONB
- **Report summaries** → queried from Supabase for dashboard (title, score, verdict, date)
- **Usage tracking** → `monthly_usage` table, incremented on each report generation
- **User plan/credits** → `users` table, updated by Stripe webhook on payment
- **Transactions** → every payment logged in `transactions` table for audit
- **Cross-device access** → reports available from any device once signed in (all in Supabase)

### Cost Per Report
- Claude API call: ~$0.05–0.15 (Sonnet, 4K output)
- URL fetch: free (Netlify function)
- Clerk: free tier covers 10K MAU
- Stripe fee: 1.75% + $0.30 AUD (domestic cards)
- **Total COGS per $1 starter (2 reports): ~$0.62–0.82** (2x Claude + Stripe fee)
- **Revenue per starter report: $0.50** (still profitable at ~$0.10–0.15 Claude cost each)
- **Total COGS per $4.99 report: ~$0.48–0.58** (~88% margin)
- **Pro plan at $9/mo, avg 5 reports: ~$1.06 COGS** (~88% margin)
- Stripe subscription fees are lower per-transaction than one-time payments

## Stripe Integration (Next Phase)

When ready to charge:
1. Create Stripe account
2. Create products: "First Report ($1)", "Pro ($9/mo)", "Pro+ ($19/mo)"
3. Add Stripe checkout before report generation
4. Verify payment before calling Claude API

For now, the system generates reports without payment (for testing).

## What's Left to Build

- [ ] Screenshot/photo upload handling (file → base64 → Claude vision)
- [ ] Report history on dashboard — currently reads from Supabase, needs pagination
- [ ] Compare view (side-by-side reports)
- [ ] Price alerts (background scheduled checks)
- [ ] Email receipts (Stripe handles this automatically if enabled)
- [ ] Saved listings feature
- [ ] Report PDF export (html-to-pdf via Netlify function)
