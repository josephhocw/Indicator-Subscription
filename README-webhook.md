# Stripe Webhook — RHO Market Navigator

Serverless function that replaces the Zapier automation for handling Stripe subscription events.

## What it does

When a customer subscribes or cancels via Stripe Checkout:

| Event | Actions |
|-------|---------|
| `customer.subscription.created` | Appends row to Google Sheet, sends onboarding email, sends Telegram notification |
| `customer.subscription.deleted` | Updates sheet status to CANCELLED, sends Telegram notification |

## Environment variables

Set these in the [Vercel dashboard](https://vercel.com/dashboard) under Settings > Environment Variables.

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) — generated when you create the endpoint in Stripe |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON key for a Google service account, pasted as a single line. The service account must have Editor access to the spreadsheet. |
| `GOOGLE_SHEET_ID` | The spreadsheet ID from the Google Sheets URL (`https://docs.google.com/spreadsheets/d/{THIS_PART}/edit`) |
| `RESEND_API_KEY` | API key from [Resend](https://resend.com) (`re_...`) |
| `FROM_EMAIL` | Sender address for onboarding emails (must be verified in Resend) |
| `TELEGRAM_BOT_TOKEN` | Bot token for admin notifications (`123456:ABC-DEF...`) |
| `ADMIN_CHAT_ID` | Your Telegram chat ID for receiving admin alerts |
| `TELEGRAM_INVITE_HK` | Telegram invite link for Hong Kong Market group |
| `TELEGRAM_INVITE_SG` | Telegram invite link for Singapore Market group |
| `TELEGRAM_INVITE_US` | Telegram invite link for US Market group |
| `TELEGRAM_INVITE_FXMC` | Telegram invite link for FXMC Market group |

## Stripe webhook setup

1. Go to [Stripe Dashboard > Developers > Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set the endpoint URL to:
   ```
   https://rho-market-navigator.vercel.app/api/stripe-webhook
   ```
4. Under **Events to send**, select:
   - `customer.subscription.created`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Copy the **Signing secret** (`whsec_...`) and add it as `STRIPE_WEBHOOK_SECRET` in Vercel

## Price ID mapping

Open `lib/plans.ts` and replace the `price_TODO_*` placeholders with your real Stripe price IDs. You can find these in [Stripe Dashboard > Products](https://dashboard.stripe.com/products) — click each product/price to see the ID (`price_...`).

## Local testing with Stripe CLI

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli)

2. Log in:
   ```bash
   stripe login
   ```

3. Create a `.env.local` file with all the env vars from `.env.example` (use test-mode keys)

4. Start the Vercel dev server:
   ```bash
   npx vercel dev
   ```

5. In a separate terminal, forward Stripe test events to your local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe-webhook
   ```
   Copy the webhook signing secret it prints and set it as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

6. Trigger a test event:
   ```bash
   stripe trigger customer.subscription.created
   ```

7. Check the terminal output, your test Google Sheet, and your Telegram bot for results.

## Deploying

Just push to main — Vercel auto-deploys from the connected GitHub repo.

```bash
git add -A && git commit -m "Add Stripe webhook" && git push
```

After deploying, verify the endpoint is live:
```bash
curl -s -o /dev/null -w "%{http_code}" https://rho-market-navigator.vercel.app/api/stripe-webhook
# Should return 405 (Method Not Allowed) since it only accepts POST
```

## Parallel-run plan (migrating from Zapier)

Run both Zapier and this webhook simultaneously during testing to avoid downtime.

### Step 1: Test with a separate sheet
1. Create a copy of "RHO Navigator Subscriptions" called "RHO Navigator Subscriptions (TEST)"
2. Set `GOOGLE_SHEET_ID` in Vercel to the test sheet's ID
3. Use Stripe **test mode** keys for `STRIPE_SECRET_KEY`
4. Create the webhook endpoint in Stripe's **test mode** dashboard

### Step 2: Verify in test mode
1. Create a test subscription in Stripe test mode
2. Confirm all three actions fire:
   - Row appears in the test sheet with correct data
   - Onboarding email arrives (use a real email you control)
   - Telegram notification appears in your admin chat
3. Cancel the test subscription and confirm the sheet status updates to CANCELLED

### Step 3: Add as second listener in live mode
1. Keep Zapier running on the live webhook
2. Add this Vercel endpoint as a **second** webhook in Stripe's **live mode** dashboard
3. Both Zapier and Vercel will receive the same events — the sheet will get duplicate rows, which is expected
4. Monitor for a few real subscriptions to confirm everything works

### Step 4: Cut over
1. Once confident, delete the Zapier webhook from Stripe (or disable the Zap)
2. Switch `GOOGLE_SHEET_ID` from the test sheet to the real sheet
3. Remove any duplicate test rows from the real sheet
4. Done — Zapier can be fully deactivated

## File structure

```
api/
  stripe-webhook.ts    — Vercel serverless function (POST /api/stripe-webhook)
lib/
  sheets.ts            — Google Sheets append & update
  email.ts             — Onboarding email via Resend
  telegram.ts          — Admin notifications via Telegram Bot API
  plans.ts             — Stripe price ID mapping, plan display names, invite links
```
