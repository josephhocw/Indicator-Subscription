import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { appendSubscriber, updateStatusByCustomerId } from "../lib/sheets.js";
import { sendOnboardingEmail, type OnboardingEmailData } from "../lib/email.js";
import { notifyAdmin } from "../lib/telegram.js";
import { getPlanType, getPlanDisplayName } from "../lib/plans.js";

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

// Vercel must deliver the raw body for Stripe signature verification.
// Setting this config disables Vercel's automatic JSON parsing.
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // --- Signature verification ---
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe().webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Signature verification failed:", message);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // --- Route by event type ---
  console.log(`Stripe event: ${event.type} | ${event.id}`);

  try {
    switch (event.type) {
      case "customer.subscription.created":
        await handleSubscriptionCreated(event);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error handling ${event.type}:`, message);

    // Notify admin about the failure
    await notifyAdmin(
      `<b>Webhook Error</b>\nEvent: ${event.type}\nID: ${event.id}\nError: ${message}`
    ).catch((telegramErr) =>
      console.error("Failed to send Telegram error alert:", telegramErr)
    );

    res.status(500).json({ error: "Internal handler error" });
  }
}

async function handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Get customer details from Stripe
  const customer = await stripe().customers.retrieve(customerId);
  if (customer.deleted) throw new Error(`Customer ${customerId} is deleted`);

  // Get plan type from the first subscription item's price
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) throw new Error("No price ID found on subscription");
  const planType = getPlanType(priceId);

  // Extract custom fields (TradingView & Telegram usernames)
  // Stripe Checkout stores these on the session, not the subscription.
  const sessions = await stripe().checkout.sessions.list({
    subscription: subscription.id,
    limit: 1,
  });
  const session = sessions.data[0];
  const { tvUsername, tgUsername } = parseCustomFields(session);

  // Calculate dates in Singapore timezone (GMT+8)
  const startDate = formatDisplayDateSGT(subscription.start_date);

  // Get billing period end — use current_period_end, fall back to calculating from interval
  const periodEnd = subscription.current_period_end
    || calculatePeriodEnd(subscription);
  const expiryDate = periodEnd ? formatDisplayDateSGT(periodEnd) : startDate;

  const name = customer.name || customer.email || "Unknown";
  const email = customer.email || "";
  const planName = getPlanDisplayName(planType);

  // Run all three actions concurrently
  await Promise.all([
    appendSubscriber({
      email,
      customerName: name,
      tradingViewUsername: tvUsername,
      telegramUsername: tgUsername,
      planType,
      subscriptionStart: startDate,
      subscriptionExpiry: expiryDate,
      stripeCustomerId: customerId,
    }),

    sendOnboardingEmail({
      email,
      name,
      planType,
      tvUsername,
      telegramUsername: tgUsername,
      billingEndDate: expiryDate,
    }),

    notifyAdmin(
      [
        `<b>New Subscriber</b>`,
        `Plan: ${planName} (${planType})`,
        `Name: ${name}`,
        `Email: ${email}`,
        `TradingView: ${tvUsername || "(not provided)"}`,
        `Telegram: ${tgUsername || "(not provided)"}`,
        `Stripe: ${customerId}`,
      ].join("\n")
    ),
  ]);

  console.log(`Processed subscription.created for ${customerId} (${planType})`);
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  await Promise.all([
    updateStatusByCustomerId(customerId, "CANCELLED"),
    notifyAdmin(`<b>Subscription Cancelled</b>\nCustomer: ${customerId}`),
  ]);

  console.log(`Processed subscription.deleted for ${customerId}`);
}

// --- Helpers ---

/**
 * Parse custom fields from checkout session.
 * Handles two formats:
 * 1. Separate fields keyed "tradingview_username" and "telegram_username"
 * 2. Single comma-separated string: "tvUsername, telegramUsername"
 */
function parseCustomFields(
  session: Stripe.Checkout.Session | undefined
): { tvUsername: string; tgUsername: string } {
  if (!session?.custom_fields?.length) {
    return { tvUsername: "", tgUsername: "" };
  }

  const fields = session.custom_fields;

  // Try separate named fields first
  // Stripe generates keys by lowercasing labels and removing spaces/special chars
  const tvField = fields.find((f) => f.key.includes("tradingview"));
  const tgField = fields.find((f) => f.key.includes("telegram"));

  if (tvField || tgField) {
    return {
      tvUsername: tvField?.text?.value?.trim() || "",
      tgUsername: tgField?.text?.value?.trim() || "",
    };
  }

  // Fallback: first field might be comma-separated "tvUser, tgUser"
  const combined = fields[0]?.text?.value || "";
  const parts = combined.split(",");
  return {
    tvUsername: parts[0]?.trim() || "",
    tgUsername: parts[1]?.trim() || "",
  };
}

/**
 * Fallback: calculate period end from subscription interval if current_period_end is missing.
 */
function calculatePeriodEnd(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0];
  if (!item?.price?.recurring) return null;

  const { interval, interval_count } = item.price.recurring;
  const start = new Date(subscription.start_date * 1000);

  switch (interval) {
    case "day":
      start.setDate(start.getDate() + interval_count);
      break;
    case "week":
      start.setDate(start.getDate() + interval_count * 7);
      break;
    case "month":
      start.setMonth(start.getMonth() + interval_count);
      break;
    case "year":
      start.setFullYear(start.getFullYear() + interval_count);
      break;
  }

  return Math.floor(start.getTime() / 1000);
}

/**
 * Format a Unix timestamp as "16 April 2026 18:00" in Singapore timezone (GMT+8).
 * Used for both Google Sheet and email display.
 */
function formatDisplayDateSGT(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const day = parts.find((p) => p.type === "day")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const year = parts.find((p) => p.type === "year")!.value;
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  return `${day} ${month} ${year} ${hour}:${minute}`;
}
