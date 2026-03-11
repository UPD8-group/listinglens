# Listing Lens — Code Audit Results

## BUGS FOUND AND FIXED (8 + 1 bonus)

### BUG 1: index.html uses .html extension links ✅ FIXED
- **Where**: index.html — nav, footer, CTA
- **Problem**: Links to `pricing.html`, `privacy.html`, `terms.html` instead of `/pricing`, `/privacy`, `/terms`
- **Fix**: Changed all to clean URLs matching netlify.toml rewrites

### BUG 2: Supabase RLS blocks ALL dashboard reads ✅ FIXED
- **Where**: dashboard.html queried Supabase with anon key
- **Problem**: RLS enabled with NO read policies. Every query returns empty.
- **Fix**: Created `get-dashboard.js` Netlify function (server-side, service_role key bypasses RLS). Dashboard now fetches via API. Removed Supabase CDN from dashboard.html entirely.

### BUG 2b: Same RLS issue on report.html ✅ FIXED
- **Where**: report.html Route 1 loaded reports with anon key
- **Fix**: Created `get-report.js` Netlify function. Removed Supabase CDN from report.html entirely.

### BUG 3: create-checkout.js and stripe-webhook.js crash on missing env vars ✅ FIXED
- **Fix**: Added conditional `createClient()` with null guard (matching generate-report.js pattern)

### BUG 4: Stripe Checkout rejects `currency` param with predefined prices ✅ FIXED
- **Fix**: Removed `currency: "aud"` — currency is already set in the Stripe Price objects

### BUG 5: Double monthly usage increment for subscription users ✅ FIXED
- **Fix**: Removed `increment_monthly_usage` from Step 3 of generate-report.js. `deductCredit()` already handles this for token flow.

### BUG 6: Subscription purchase flow disconnected ✅ FIXED
- **Fix**: Added `product` field to each tier in pricing.html. New `selectPlan()` function stores choice in sessionStorage. Dashboard checks for `ll_pending_plan` on load and auto-triggers Stripe checkout.

### BUG 7: `is_international` detection always false ✅ FIXED
- **Fix**: Changed from `!!(report.fxCard)` to regex check for non-AUD currency symbols (¥, €, £, ₹, ₩) in report tags

### BUG 8: Netlify functions dependencies never installed ✅ FIXED
- **Fix**: Added root `package.json` with stripe + supabase deps. Added `command = "npm install"` to netlify.toml. Removed incorrect `included_files` directive.

## ADDITIONAL ISSUES (non-breaking)

- Privacy/terms emails use "(at)" instead of actual mailto links (intentional — avoids scraping)
- Dashboard approximates red flag count from score instead of counting actual flags (needs report_data query)
- No favicon configured
- No 404 page
