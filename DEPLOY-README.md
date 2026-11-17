# Tawsiya v8: the AI visibility system (live reports, control room, before/after, money)

Tawsiya is now a subscription web app. A business gets a free Score in minutes, then pays with Ziina for a month of weekly tracking.
It runs as ONE Render **Web Service** (Node) plus ONE **Postgres** database. Phones can install it from the browser ("Add to Home Screen").

## How it works
1. **Free Score** (/score/): the visitor enters website, business name, what they do, area. The system loads the website, runs 15 checks, asks ChatGPT, Gemini, Claude and Perplexity real customer questions (with web search on) and publishes a private report in 1 to 3 minutes. An email goes to the visitor.
2. **Plans** (/plans/): Free report, Track (AED 199/month, the client does the fixes), Grow (AED 799/month, you do the fixes). Change them any time in Admin > Billing > Plans; the home page follows.
3. **Paying with Ziina**: "Choose plan" opens Ziina's secure payment page (card, Apple Pay, Google Pay). After payment the plan is active for one month (or year) and the first check starts.
   Ziina has no automatic recurring billing, so plans are **prepaid**: 7 days and 1 day before the end, the client gets an email with a "Renew" link; renewing early adds a month after the current end. If they do not renew, the account returns to the free plan after a 3-day grace period (history kept). Changing plan credits the unused days of the current plan (Ziina's minimum payment is AED 2).
4. **Every week** the system re-checks each paying business: answers from every assistant, competitors named, sources used, website checks, auto "Fix:" tasks. The client gets an email summary.
5. **Clients** manage everything in their dashboard: questions asked, competitors tracked, business facts, plan and payments (renew, change plan, payment history).
6. **You** see everything in /admin/: Billing (monthly value, plans, who has paid until when, every Ziina checkout and payment, plan editor), Automation (connections + Test buttons, every check with every answer, jobs, emails), plus the earlier tabs.


## New in v8: money, prices and design

**Prices (and why).** All figures are estimates in AED; check them against your real bills after the first month.

| Plan | Price | AI cost per month | Ziina fee | Left for you |
|---|---|---|---|---|
| Free report | 0 | about 0.5 to 1.5 per report | none | a cost, capped by the budget |
| Track (client does the fixes) | 199 | about 10 to 25 | about 7 | about 165 to 180 |
| Grow (you do the fixes) | 799 | about 20 to 70 | about 25 | about 700 to 750, before your own time |

Fixed costs are about AED 60 a month (Render web service about USD 7 + database about USD 6, plus the domain), so one Track client covers them. Grow is priced higher because your time is the real cost there.

**Admin > Money** shows this month: money in, Ziina fees, AI cost, fixed costs and what is left, plus what each plan leaves per client. AI cost is estimated from the usage each assistant reports; your real bill is on each provider's usage page.

**Cost controls (Admin > Money, no redeploy needed):**
- Free reports per day (default 10).
- Monthly AI budget (default AED 300). When the estimate reaches it, new free reports wait in Admin > Scans and you get an email. Paid clients' weekly scans and your own scans keep running.
- Fixed monthly costs (used only for the "left for you" figure).
- The model each assistant uses. Leave empty for the default.

**AI models (checked 16 Nov 2026).** Defaults: ChatGPT `gpt-6-luna`, Gemini `gemini-3.1-flash-lite`, Claude `claude-haiku-5-5`, Perplexity `perplexity/sonar` (Agent API). Providers retire models often, so if a model is refused Tawsiya tries the next one by itself and Admin > Money shows which one is in use.

**Starting with Gemini only:** on Google's free tier the newer Gemini models answer without Google Search. Tawsiya handles that and marks "Web search: off" in Admin > Money. Answers are then from the model's memory, which is fine for testing but weaker for real reports. Turn on billing in Google AI Studio to get search (a monthly free allowance applies; check Google's pricing page).

**When a client pays:** the plan switches on after the payment is re-checked with Ziina, the first scan starts by itself, and you get an email plus a new item in Admin > Leads. Weekly scans ask as many questions as the plan allows (Track 10, Grow 20); the first scan's questions stay first so before/after stays fair, and questions a client chose themselves are never changed. Grow includes you doing the fixes, so open Admin > Clients and start their action plan.

**Design.** New home page (dark "stage" hero with a live example report, what the report holds, before/after, the three plans), warm paper background, and a darker header on reports. The home page now shows the same plans and prices as /plans/.

## New in v7: how you run the service
1. **A visitor pastes their website** on /score/. Nothing else is required. The report page opens straight away and builds live: it opens the site, reads up to 8 pages, works out the business (name, what it does, area, phone, profiles), asks ChatGPT, Gemini, Claude and Perplexity real customer questions plus "what do you know about us", then shows the full report. It takes 1 to 3 minutes.
2. **The report** (at /report/<link>/, Arabic or English, save as PDF, share on WhatsApp) shows:
   - a score out of 100 across four parts: AI visibility, can AI read the site, clear business facts, trust;
   - what each AI says about the business by name;
   - every customer question, assistant by assistant, and who was named instead;
   - which websites AI takes its information from;
   - 25 checks;
   - an action plan ordered by impact, with why and how to fix each item.
3. **Admin > Scans**: scan any business yourself (prospects before you call them, no daily limit), set the lead status, open the report, copy the link or send it on WhatsApp in one click. "Make client" turns a scan into a client: that scan becomes the **before**, and the action plan is created automatically. If the person already has an account, type their email so it links to it.
4. **Admin > Clients > Open**: the client's workspace.
   - An action plan board (To do / Doing / Done). Items are marked Tawsiya or Client, can be hidden, and can carry a note the client will see.
   - "Run a new scan now", score history, and "Use as before" to choose the baseline.
   - The before/after link (Arabic and English) and private notes.
   - When a later scan shows an item is fixed, it closes by itself.
5. **The before/after report** (/progress/<link>/) compares the baseline with the latest scan:
   - score and the four parts;
   - named in answers;
   - fixed items, items still in progress, and new issues;
   - the same questions, before and after;
   - the work you did.

   Send it on WhatsApp from the client workspace, or press "New link" to cancel an old one.
6. **The client dashboard** now starts with "Your growth plan": before and now scores, the full report, the before/after report, and the items in progress. Items marked Client can be ticked by them.

Weekly scans reuse the questions from the "before" scan (unless the client set their own) so the comparison is fair.

## What you need to sign up for (and what to paste where)
Each one switches on when its key is in Render > your web service > Environment. Nothing breaks if one is missing; that part is marked "not connected".

| Service | Why | Where to get it | Render variable(s) |
|---|---|---|---|
| **Ziina** (required to take payments) | Card / Apple Pay / Google Pay payments in AED | Your Ziina business account > ziina.com/business/connect > create an API key (it needs permission to create payment intents and webhooks; if you don't see it, ask Ziina support to enable API access) | `ZIINA_API_KEY` |
| Ziina webhook | Tells Tawsiya a payment finished | Make up a long random password and put it in `ZIINA_WEBHOOK_SECRET`. After deploying: Admin > Automation > **Register webhook with Ziina** (it registers `https://gettawsiya.com/api/ziina/webhook`) | `ZIINA_WEBHOOK_SECRET` |
| Ziina test mode | Try everything without real money | `ZIINA_TEST_MODE=1` (default in render.yaml). Test payments accept any card. Set to `0` when ready to take real money. | `ZIINA_TEST_MODE` |
| **OpenAI** | ChatGPT answers | platform.openai.com > API keys; add billing credit | `OPENAI_API_KEY` |
| **Google Gemini** | Gemini / Google AI answers | aistudio.google.com > Get API key (enable billing for Search grounding) | `GEMINI_API_KEY` |
| **Anthropic** | Claude answers | console.anthropic.com > API keys; add credit | `ANTHROPIC_API_KEY` |
| **Perplexity** | Perplexity answers | perplexity.ai > Settings > API; add credit | `PERPLEXITY_API_KEY` |
| **Resend** (strongly recommended) | Emails: reports, weekly summary, password reset, payment failed | resend.com > add domain gettawsiya.com > add the DNS records it shows in Hostinger > API keys | `RESEND_API_KEY` (and `MAIL_FROM` if not hello@gettawsiya.com) |
| Google Places (optional) | Auto-checks Google Business Profile + reviews | console.cloud.google.com > enable "Places API (New)" > Credentials > API key (restrict it to Places API) | `GOOGLE_PLACES_API_KEY` |

After adding keys: Admin > Automation > press **Test** next to each one.

**Costs to expect:** see the price table in "New in v8" above, and watch Admin > Money. Start each AI account with a small prepaid balance (USD 5 to 10) and leave auto-recharge off.

## Deploy steps
1. Replace the contents of your GitHub repo `gettawsiya-site` with the unzipped files (root must have `site/`, `server/`, `render.yaml`).
2. Render > **New > Blueprint** > pick the repo. It creates the web service `tawsiya` and the database `tawsiya-db`.
3. Fill the environment variables (table above, plus `ADMIN_EMAIL`, `ADMIN_PASSWORD`). Deploy.
4. Open `https://<service>.onrender.com/healthz` → `{"ok":true}`. Sign in at `/en/signin/` with the admin email: you land on `/admin/`.
5. Domain: in the web service > Settings > Custom Domains add `gettawsiya.com` and `www.gettawsiya.com`; update the A and CNAME records in Hostinger to what Render shows. Delete the old static site and the old failed web service.
6. Ziina: keep `ZIINA_TEST_MODE=1`, register the webhook (Admin > Automation), then buy a plan from a test client account with any card. Check Admin > Billing shows the payment and the plan. Then set `ZIINA_TEST_MODE=0` and redeploy.
   Security: Tawsiya never trusts the webhook content; it always re-reads the payment from Ziina and checks the amount before activating. The customer's return to the dashboard also confirms the payment, so a late webhook does not block them.
7. Use a paid Render instance (free ones sleep, which stops the weekly checks) and turn on database backups.

## Founding clients who pay by bank transfer
Admin > Businesses > open the business > "Set plan" (optionally with an end date). They get the paid features without paying online.

## Updating text or design
Edit in `src/`, run `python3 src/build.py`, copy `dist/` to `site/` in the repo (keep `_tpl`), commit. Render redeploys.

## Tests (for a developer)
`server/test/run.js` (124 checks), `server/test/v6.js` (94), `server/test/v8.js` (30: prices, costs, budget guard, model fallbacks, paid plans fill their question count) and `server/test/v7.js` (42: URL-only scan, live report, control room, action plan, before/after). They use `server/test/mock.js` to simulate Ziina, the four AI services, Resend, Google Places and test websites. All pass.

## Honest limits
- API answers can differ from what a signed-in person sees in the ChatGPT app; the Method page says so.
- "Names mentioned" (competitors) are detected from the answer formatting; occasionally a heading or a non-business word can appear.
- Website checks read the HTML; sites built only with JavaScript can score lower than they deserve (the report says why).
- Detecting the business from its website uses the page text, and one AI read when a key is connected. If it gets the category wrong, add details on /score/ or use Re-run in Admin > Scans with the right name or category.
- Ziina's docs do not say exactly which key signs webhooks; we use the secret you register (as the docs describe) and also re-read every payment from Ziina, so payments stay safe either way. Refunds: do them in your Ziina dashboard.
- Prices, partner commission and the Paid plans terms are drafts: approve them and have a UAE lawyer review the terms and privacy policy.
