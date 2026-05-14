import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import {
  appendNewSubscriber,
  findRowByEmail,
  findRowBySubscriptionId,
  updateRowFields,
  type RowPatch,
  type SheetRow,
} from "../lib/sheets.js";
import {
  sendOnboardingEmail,
  sendPaymentFailedEmail,
  sendCancellationConfirmationEmail,
} from "../lib/email.js";
import { notifyAdmin } from "../lib/telegram.js";
import {
  getPlanType,
  getPlanDisplayName,
  classifyPlanChange,
} from "../lib/plans.js";

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

// Vercel must deliver the raw body for Stripe signature verification.
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

  console.log(`Stripe event: ${event.type} | ${event.id}`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
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

    await notifyAdmin(
      `<b>Webhook Error</b>\nEvent: ${event.type}\nID: ${event.id}\nError: ${message}`
    ).catch((telegramErr) =>
      console.error("Failed to send Telegram error alert:", telegramErr)
    );

    res.status(500).json({ error: "Internal handler error" });
  }
}

// =====================================================================
// Handler: checkout.session.completed
// New subscription OR reactivation (returning subscriber email match).
// =====================================================================

async function handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode !== "subscription") {
    console.log(`Ignoring non-subscription checkout session: ${session.id}`);
    return;
  }

  const subscriptionId = idFrom(session.subscription);
  const customerId = idFrom(session.customer);
  if (!subscriptionId || !customerId) {
    throw new Error(
      `Checkout session ${session.id} missing subscription or customer`
    );
  }

  // Pull the subscription so we get current_period_end and the price.
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) throw new Error(`No price ID on subscription ${subscriptionId}`);
  const planType = getPlanType(priceId);
  const planName = getPlanDisplayName(planType);

  const email =
    session.customer_email ||
    session.customer_details?.email ||
    "";
  const name =
    session.customer_details?.name ||
    email ||
    "Unknown";
  const { tvUsername, tgUsername } = parseCustomFields(session);

  const startDate = formatDisplayDateSGT(subscription.start_date);
  const periodEnd =
    subscription.current_period_end || calculatePeriodEnd(subscription);
  const expiryDate = periodEnd ? formatDisplayDateSGT(periodEnd) : startDate;
  // Stripe fires invoice.payment_succeeded right after checkout, but we
  // populate Last Payment Date here so the new row is complete from the start.
  const lastPaymentDate = startDate;

  const existing = email ? await findRowByEmail(email) : null;
  const isReactivation = !!existing;

  if (existing) {
    const previousPlanType =
      existing.planType && existing.planType !== planType
        ? existing.planType
        : existing.previousPlanType;

    await updateRowFields(existing.rowIndex, {
      customerName: name,
      tradingViewUsername: tvUsername,
      telegramUsername: tgUsername,
      planType,
      previousPlanType,
      subscriptionStart: startDate,
      subscriptionExpiry: expiryDate,
      lastPaymentDate,
      status: "ACTIVE",
      latestAction: "REACTIVATED",
      subscriptionCount: existing.subscriptionCount + 1,
      failedPaymentCount: 0,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
  } else {
    await appendNewSubscriber({
      email,
      customerName: name,
      tradingViewUsername: tvUsername,
      telegramUsername: tgUsername,
      planType,
      subscriptionStart: startDate,
      subscriptionExpiry: expiryDate,
      lastPaymentDate,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
  }

  await Promise.all([
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
        `<b>${isReactivation ? "Returning Subscriber" : "New Subscriber"}</b>`,
        `Plan: ${planName} (${planType})`,
        `Name: ${name}`,
        `Email: ${email}`,
        `TradingView: ${tvUsername || "(not provided)"}`,
        `Telegram: ${tgUsername || "(not provided)"}`,
        `Expires: ${expiryDate}`,
        `Stripe Customer: ${customerId}`,
        `Stripe Sub: ${subscriptionId}`,
      ].join("\n")
    ),
  ]);

  console.log(
    `Processed checkout.session.completed for ${email} (${planType}) — ${
      isReactivation ? "reactivation" : "new"
    }`
  );
}

// =====================================================================
// Handler: invoice.payment_succeeded
// Only acts on renewal cycles. New-sub payments are covered by checkout.
// =====================================================================

async function handleInvoicePaymentSucceeded(
  event: Stripe.Event
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  if (invoice.billing_reason !== "subscription_cycle") {
    console.log(
      `Skipping invoice.payment_succeeded with billing_reason=${invoice.billing_reason}`
    );
    return;
  }

  const subscriptionId = idFrom(invoice.subscription);
  if (!subscriptionId) {
    console.log(`Renewal invoice ${invoice.id} has no subscription id`);
    return;
  }

  const existing = await findRowBySubscriptionId(subscriptionId);
  if (!existing) {
    await notifyAdmin(
      `<b>Renewal received but no sheet row found</b>\nSub: ${subscriptionId}\nInvoice: ${invoice.id}`
    );
    return;
  }

  const periodStart = formatDisplayDateSGT(invoice.period_start);
  const periodEnd = formatDisplayDateSGT(invoice.period_end);
  const paymentDate = formatDisplayDateSGT(invoice.created);

  await updateRowFields(existing.rowIndex, {
    subscriptionStart: periodStart,
    subscriptionExpiry: periodEnd,
    lastPaymentDate: paymentDate,
    latestAction: "RENEWAL",
    subscriptionCount: existing.subscriptionCount + 1,
    failedPaymentCount: 0,
  });

  await notifyAdmin(
    [
      `<b>Renewal Charged</b>`,
      `Name: ${existing.customerName}`,
      `Email: ${existing.email}`,
      `Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
      `New expiry: ${periodEnd}`,
      `Subscription #: ${existing.subscriptionCount + 1}`,
    ].join("\n")
  );

  console.log(
    `Processed renewal for ${existing.email} (${existing.planType})`
  );
}

// =====================================================================
// Handler: invoice.payment_failed
// =====================================================================

async function handleInvoicePaymentFailed(
  event: Stripe.Event
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = idFrom(invoice.subscription);
  if (!subscriptionId) {
    console.log(`Failed invoice ${invoice.id} has no subscription id`);
    return;
  }

  const existing = await findRowBySubscriptionId(subscriptionId);
  if (!existing) {
    await notifyAdmin(
      `<b>Payment failed but no sheet row found</b>\nSub: ${subscriptionId}\nInvoice: ${invoice.id}`
    );
    return;
  }

  const newFailedCount = existing.failedPaymentCount + 1;
  const attemptCount = invoice.attempt_count ?? newFailedCount;
  const nextAttemptDate = invoice.next_payment_attempt
    ? formatDisplayDateSGT(invoice.next_payment_attempt)
    : undefined;

  await updateRowFields(existing.rowIndex, {
    failedPaymentCount: newFailedCount,
  });

  await Promise.all([
    sendPaymentFailedEmail({
      email: existing.email,
      name: existing.customerName,
      planType: existing.planType,
      attemptCount,
      nextAttemptDate,
    }),
    notifyAdmin(
      [
        `<b>Payment Failed</b>`,
        `Name: ${existing.customerName}`,
        `Email: ${existing.email}`,
        `Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
        `Attempt: ${attemptCount}`,
        `Next retry: ${nextAttemptDate || "(none — final attempt)"}`,
      ].join("\n")
    ),
  ]);

  console.log(
    `Processed payment_failed for ${existing.email} (attempt ${attemptCount})`
  );
}

// =====================================================================
// Handler: customer.subscription.updated
// Detect plan change, cancel-at-period-end, or status → past_due.
// Multiple changes can happen in the same event; handle each independently.
// =====================================================================

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const previous = (event.data.previous_attributes ||
    {}) as Partial<Stripe.Subscription>;

  const existing = await findRowBySubscriptionId(subscription.id);
  if (!existing) {
    console.log(
      `subscription.updated for unknown sub ${subscription.id} — skipping`
    );
    return;
  }

  // --- 1. Plan change (items changed) ---
  if (previous.items) {
    await handlePlanChange(subscription, existing);
  }

  // --- 2. Cancellation scheduled (cancel_at_period_end flipped to true) ---
  if (
    previous.cancel_at_period_end === false &&
    subscription.cancel_at_period_end === true
  ) {
    await handleCancellationScheduled(subscription, existing);
  }

  // --- 3. Status change → past_due ---
  if (previous.status && subscription.status === "past_due") {
    await notifyAdmin(
      [
        `<b>Subscription Past Due</b>`,
        `Name: ${existing.customerName}`,
        `Email: ${existing.email}`,
        `Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
      ].join("\n")
    );
  }
}

async function handlePlanChange(
  subscription: Stripe.Subscription,
  existing: SheetRow
): Promise<void> {
  const newPriceId = subscription.items.data[0]?.price.id;
  if (!newPriceId) return;
  const newPlanType = getPlanType(newPriceId);
  const oldPlanType = existing.planType;

  if (oldPlanType === newPlanType) return;

  const action = classifyPlanChange(oldPlanType, newPlanType);

  await updateRowFields(existing.rowIndex, {
    planType: newPlanType,
    previousPlanType: oldPlanType,
    latestAction: action,
  });

  await notifyAdmin(
    [
      `<b>Plan Change: ${action}</b>`,
      `Name: ${existing.customerName}`,
      `Email: ${existing.email}`,
      `From: ${getPlanDisplayName(oldPlanType)} (${oldPlanType})`,
      `To: ${getPlanDisplayName(newPlanType)} (${newPlanType})`,
      `TradingView: ${existing.tradingViewUsername || "(not in sheet)"}`,
      `Telegram: ${existing.telegramUsername || "(not in sheet)"}`,
      `<i>Update TradingView indicator access manually.</i>`,
    ].join("\n")
  );

  console.log(
    `Plan change for ${existing.email}: ${oldPlanType} → ${newPlanType} (${action})`
  );
}

async function handleCancellationScheduled(
  subscription: Stripe.Subscription,
  existing: SheetRow
): Promise<void> {
  // Access continues until period end; subscription stays "active" in Stripe.
  const periodEnd =
    subscription.current_period_end || calculatePeriodEnd(subscription);
  const accessEndDate = periodEnd
    ? formatDisplayDateSGT(periodEnd)
    : existing.subscriptionExpiry;

  const patch: RowPatch = {
    latestAction: "CANCELLED",
  };
  // Refresh expiry from Stripe in case it shifted.
  if (periodEnd) patch.subscriptionExpiry = accessEndDate;

  await updateRowFields(existing.rowIndex, patch);

  await Promise.all([
    sendCancellationConfirmationEmail({
      email: existing.email,
      name: existing.customerName,
      planType: existing.planType,
      accessEndDate,
    }),
    notifyAdmin(
      [
        `<b>Cancellation Scheduled</b>`,
        `Name: ${existing.customerName}`,
        `Email: ${existing.email}`,
        `Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
        `Access until: ${accessEndDate}`,
      ].join("\n")
    ),
  ]);

  console.log(
    `Cancellation scheduled for ${existing.email} — access ends ${accessEndDate}`
  );
}

// =====================================================================
// Handler: customer.subscription.deleted
// Final access end — either at period end or force-cancel.
// =====================================================================

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;

  const existing = await findRowBySubscriptionId(subscription.id);
  if (!existing) {
    await notifyAdmin(
      `<b>Subscription deleted but no sheet row found</b>\nSub: ${subscription.id}`
    );
    return;
  }

  await updateRowFields(existing.rowIndex, {
    status: "CANCELLED",
  });

  await notifyAdmin(
    [
      `<b>Subscription Ended</b>`,
      `Name: ${existing.customerName}`,
      `Email: ${existing.email}`,
      `Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
      `TradingView: ${existing.tradingViewUsername || "(not in sheet)"}`,
      `<i>Remove TradingView indicator access manually.</i>`,
    ].join("\n")
  );

  console.log(`Processed subscription.deleted for ${existing.email}`);
}

// =====================================================================
// Helpers
// =====================================================================

function idFrom(
  ref: string | { id: string } | null | undefined
): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

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
 * Format a Unix timestamp as "16 April 2026 18:00" in Singapore time (GMT+8).
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
