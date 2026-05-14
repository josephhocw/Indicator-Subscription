import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import {
  appendSubscriber,
  findSubscriberRow,
  findSubscriberByCustomerId,
  updateSubscriberRow,
  type ExistingSubscriber,
  type SubscriberFieldUpdate,
} from "../lib/sheets.js";
import { sendOnboardingEmail } from "../lib/email.js";
import { notifyAdmin } from "../lib/telegram.js";
import {
  getPlanType,
  getPlanDisplayName,
  getPriceIdForPlan,
} from "../lib/plans.js";

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!);

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
      case "customer.subscription.created":
        await handleSubscriptionCreated(event);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event);
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

// =============================================================================
// Event 1 — customer.subscription.created
// =============================================================================

async function handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = getCustomerId(subscription);

  // Idempotency: if this exact Stripe customer ID is already in the sheet,
  // assume this is a Stripe webhook retry and no-op.
  const existingByCustomer = await findSubscriberByCustomerId(customerId);
  if (existingByCustomer) {
    console.log(
      `Idempotent skip: customer ${customerId} already on row ${existingByCustomer.rowIndex}`
    );
    return;
  }

  const customer = await stripe().customers.retrieve(customerId);
  if (customer.deleted) throw new Error(`Customer ${customerId} is deleted`);

  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) throw new Error("No price ID found on subscription");
  const planType = getPlanType(priceId);
  const planName = getPlanDisplayName(planType);

  const session = await getCheckoutSession(subscription.id);
  const { tvUsername, tgUsername } = parseCustomFields(session);

  const startDate = formatDisplayDateSGT(subscription.start_date);
  const periodEnd =
    subscription.current_period_end || calculatePeriodEnd(subscription);
  const expiryDate = periodEnd ? formatDisplayDateSGT(periodEnd) : startDate;

  const name = customer.name || customer.email || "Unknown";
  const email = customer.email || "";

  // Look for an existing subscriber matching by email / TV / Telegram username.
  const existing = await findSubscriberRow({
    email,
    tvUsername,
    tgUsername,
  });

  if (existing && existing.status === "ACTIVE") {
    // Identity collision with an active row — append a new row but flag it.
    await appendNewSubscriber({
      email,
      name,
      tvUsername,
      tgUsername,
      planType,
      planName,
      customerId,
      startDate,
      expiryDate,
      duplicateWarning: buildDuplicateWarning(existing, {
        email,
        tvUsername,
        tgUsername,
      }),
    });
    return;
  }

  if (existing) {
    // Returning subscriber: merge into their old row.
    await mergeReturningSubscriber({
      existing,
      email,
      name,
      tvUsername,
      tgUsername,
      planType,
      planName,
      customerId,
      startDate,
      expiryDate,
    });
    return;
  }

  // True new subscriber.
  await appendNewSubscriber({
    email,
    name,
    tvUsername,
    tgUsername,
    planType,
    planName,
    customerId,
    startDate,
    expiryDate,
  });
}

interface NewSubscriberArgs {
  email: string;
  name: string;
  tvUsername: string;
  tgUsername: string;
  planType: string;
  planName: string;
  customerId: string;
  startDate: string;
  expiryDate: string;
  duplicateWarning?: string;
}

async function appendNewSubscriber(args: NewSubscriberArgs): Promise<void> {
  const {
    email,
    name,
    tvUsername,
    tgUsername,
    planType,
    planName,
    customerId,
    startDate,
    expiryDate,
    duplicateWarning,
  } = args;

  const notificationLines = [
    `<b>🆕 NEW SUBSCRIPTION</b>`,
    `Name: ${name} | Plan: ${planName} (${planType})`,
    `TradingView: ${tvUsername || "(not provided)"} | Telegram: @${tgUsername || "(not provided)"}`,
    `Start: ${startDate} → Expiry: ${expiryDate}`,
    `⚡ Action: Grant TradingView access`,
  ];
  if (duplicateWarning) notificationLines.push(duplicateWarning);

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
    notifyAdmin(notificationLines.join("\n")),
  ]);

  console.log(`Appended new subscriber for ${customerId} (${planType})`);
}

interface MergeArgs {
  existing: ExistingSubscriber;
  email: string;
  name: string;
  tvUsername: string;
  tgUsername: string;
  planType: string;
  planName: string;
  customerId: string;
  startDate: string;
  expiryDate: string;
}

async function mergeReturningSubscriber(args: MergeArgs): Promise<void> {
  const {
    existing,
    email,
    name,
    tvUsername,
    tgUsername,
    planType,
    planName,
    customerId,
    startDate,
    expiryDate,
  } = args;

  const oldPlan = existing.planType;
  const planChanged = oldPlan && oldPlan !== planType;

  const updates: SubscriberFieldUpdate = {
    email,
    customerName: name,
    tradingViewUsername: tvUsername,
    telegramUsername: tgUsername,
    planType,
    subscriptionStart: startDate,
    subscriptionExpiry: expiryDate,
    status: "ACTIVE",
    stripeCustomerId: customerId,
    renewalCount: String(parseRenewalCount(existing.renewalCount) + 1),
  };

  let changeType = "";
  if (planChanged) {
    updates.previousPlanType = oldPlan;
    changeType = await determineChangeType(existing, planType);
    updates.changeType = changeType;
  } else {
    updates.previousPlanType = "";
    updates.changeType = "";
  }

  const notificationLines = [
    `<b>🔁 RETURNING SUBSCRIBER</b>`,
    `Name: ${name} | Plan: ${planName} (${planType})`,
    `TradingView: ${tvUsername || "(not provided)"} | Telegram: @${tgUsername || "(not provided)"}`,
    `Start: ${startDate} → Expiry: ${expiryDate}`,
    `Previous status: ${existing.status || "(unknown)"} | Renewal #: ${updates.renewalCount}`,
  ];
  if (planChanged) {
    notificationLines.push(`Plan change: ${oldPlan} → ${planType} (${changeType})`);
  }
  notificationLines.push(`⚡ Action: Grant TradingView access`);

  await Promise.all([
    updateSubscriberRow(existing.rowIndex, updates),
    sendOnboardingEmail({
      email,
      name,
      planType,
      tvUsername,
      telegramUsername: tgUsername,
      billingEndDate: expiryDate,
    }),
    notifyAdmin(notificationLines.join("\n")),
  ]);

  console.log(
    `Merged returning subscriber on row ${existing.rowIndex} for ${customerId} (${planType})`
  );
}

function buildDuplicateWarning(
  existing: ExistingSubscriber,
  candidate: { email: string; tvUsername: string; tgUsername: string }
): string {
  const matchedFields: string[] = [];
  const eq = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  if (candidate.email && eq(existing.email, candidate.email)) {
    matchedFields.push("email");
  }
  if (
    candidate.tvUsername &&
    eq(existing.tradingViewUsername, candidate.tvUsername)
  ) {
    matchedFields.push("TradingView username");
  }
  if (
    candidate.tgUsername &&
    eq(existing.telegramUsername, candidate.tgUsername)
  ) {
    matchedFields.push("Telegram username");
  }
  const fields = matchedFields.join(", ") || "identity";
  return `⚠️ DUPLICATE IDENTITY: ${fields} matches existing ACTIVE row #${existing.rowIndex} (${existing.stripeCustomerId})`;
}

// =============================================================================
// Events 2 + 4 — customer.subscription.updated
// =============================================================================

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const previousAttributes = (event.data.previous_attributes || {}) as Partial<
    Stripe.Subscription
  > & { items?: { data?: Array<{ price?: { id?: string } }> } };

  const newPriceId = subscription.items.data[0]?.price.id;
  const oldPriceId = previousAttributes.items?.data?.[0]?.price?.id;

  // Priority 1: plan change
  if (newPriceId && oldPriceId && newPriceId !== oldPriceId) {
    await handlePlanChange(subscription, oldPriceId, newPriceId);
    return;
  }

  // Priority 2: cancel-at-period-end flipped false → true
  const previousCancelFlag = previousAttributes.cancel_at_period_end;
  if (
    previousCancelFlag === false &&
    subscription.cancel_at_period_end === true
  ) {
    await handleCancellationRequested(subscription);
    return;
  }

  console.log(
    `subscription.updated ignored (no plan change or cancellation request) | ${subscription.id}`
  );
}

async function handlePlanChange(
  subscription: Stripe.Subscription,
  oldPriceId: string,
  newPriceId: string
): Promise<void> {
  const customerId = getCustomerId(subscription);
  const existing = await findSubscriberByCustomerId(customerId);
  if (!existing) {
    throw new Error(`Plan change for unknown customer ${customerId}`);
  }

  const newPlanType = getPlanType(newPriceId);
  const oldPlanType = safeGetPlanType(oldPriceId) || existing.planType;

  // Fetch unit_amounts from Stripe to compare quarterly cost.
  const [oldPrice, newPrice] = await Promise.all([
    stripe().prices.retrieve(oldPriceId),
    stripe().prices.retrieve(newPriceId),
  ]);
  const oldAmount = oldPrice.unit_amount ?? 0;
  const newAmount = newPrice.unit_amount ?? 0;
  const changeType =
    newAmount > oldAmount
      ? "Upgraded"
      : newAmount < oldAmount
      ? "Downgraded"
      : "Switched Plan";

  await updateSubscriberRow(existing.rowIndex, {
    previousPlanType: oldPlanType,
    planType: newPlanType,
    changeType,
  });

  await notifyAdmin(
    [
      `<b>🔄 PLAN CHANGED — ${changeType}</b>`,
      `Name: ${existing.customerName}`,
      `TradingView: ${existing.tradingViewUsername || "(not provided)"} | Telegram: @${existing.telegramUsername || "(not provided)"}`,
      `Change: ${oldPlanType} → ${newPlanType}`,
      `⚡ Action: Update TradingView access (remove old script, grant new)`,
    ].join("\n")
  );

  console.log(
    `Plan change on row ${existing.rowIndex}: ${oldPlanType} → ${newPlanType} (${changeType})`
  );
}

async function handleCancellationRequested(
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId = getCustomerId(subscription);
  const existing = await findSubscriberByCustomerId(customerId);
  if (!existing) {
    throw new Error(`Cancellation requested for unknown customer ${customerId}`);
  }

  const periodEnd =
    subscription.current_period_end || calculatePeriodEnd(subscription);
  const expiryDate = periodEnd
    ? formatDisplayDateSGT(periodEnd)
    : existing.subscriptionExpiry;

  await notifyAdmin(
    [
      `<b>⚠️ CANCELLATION REQUESTED</b>`,
      `Name: ${existing.customerName} | Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
      `TradingView: ${existing.tradingViewUsername || "(not provided)"} | Telegram: @${existing.telegramUsername || "(not provided)"}`,
      `Start: ${existing.subscriptionStart} → Expiry: ${expiryDate}`,
      `ℹ️ Access continues until expiry`,
    ].join("\n")
  );

  console.log(`Cancellation requested for ${customerId} (row ${existing.rowIndex})`);
}

// =============================================================================
// Event 3 — customer.subscription.deleted
// =============================================================================

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = getCustomerId(subscription);

  const existing = await findSubscriberByCustomerId(customerId);
  if (!existing) {
    // Update would have failed anyway — log and notify.
    await notifyAdmin(
      `<b>🔴 SUBSCRIPTION EXPIRED</b>\nCustomer ${customerId} not found in sheet — manual cleanup needed.`
    );
    console.warn(`subscription.deleted for unknown customer ${customerId}`);
    return;
  }

  await updateSubscriberRow(existing.rowIndex, { status: "CANCELLED" });

  await notifyAdmin(
    [
      `<b>🔴 SUBSCRIPTION EXPIRED</b>`,
      `Name: ${existing.customerName} | Plan: ${getPlanDisplayName(existing.planType)} (${existing.planType})`,
      `TradingView: ${existing.tradingViewUsername || "(not provided)"} | Telegram: @${existing.telegramUsername || "(not provided)"}`,
      `Start: ${existing.subscriptionStart} → Expiry: ${existing.subscriptionExpiry}`,
      `⚡ Action: Remove TradingView access`,
    ].join("\n")
  );

  console.log(`subscription.deleted processed for ${customerId} (row ${existing.rowIndex})`);
}

// =============================================================================
// Event 5 — invoice.payment_succeeded (renewal cycle only)
// =============================================================================

async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    billing_reason?: string | null;
  };

  if (invoice.billing_reason !== "subscription_cycle") {
    console.log(
      `invoice.payment_succeeded ignored (billing_reason=${invoice.billing_reason})`
    );
    return;
  }

  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) throw new Error("Invoice missing customer ID");

  const existing = await findSubscriberByCustomerId(customerId);
  if (!existing) {
    throw new Error(`Renewal for unknown customer ${customerId}`);
  }

  // Re-confirm plan from invoice line price.
  const linePriceId = invoice.lines?.data?.[0]?.price?.id;
  const planType = linePriceId ? safeGetPlanType(linePriceId) || existing.planType : existing.planType;
  const planName = getPlanDisplayName(planType);

  // Period from invoice line (which mirrors the subscription cycle).
  const linePeriod = invoice.lines?.data?.[0]?.period;
  const startUnix = linePeriod?.start;
  const endUnix = linePeriod?.end;
  const startDate = startUnix ? formatDisplayDateSGT(startUnix) : existing.subscriptionStart;
  const expiryDate = endUnix ? formatDisplayDateSGT(endUnix) : existing.subscriptionExpiry;

  const newRenewalCount = parseRenewalCount(existing.renewalCount) + 1;

  await updateSubscriberRow(existing.rowIndex, {
    planType,
    subscriptionStart: startDate,
    subscriptionExpiry: expiryDate,
    renewalCount: String(newRenewalCount),
    changeType: "",
  });

  await notifyAdmin(
    [
      `<b>✅ SUBSCRIPTION RENEWED</b>`,
      `Name: ${existing.customerName} | Plan: ${planName} (${planType})`,
      `TradingView: ${existing.tradingViewUsername || "(not provided)"} | Telegram: @${existing.telegramUsername || "(not provided)"}`,
      `New Start: ${startDate} → New Expiry: ${expiryDate}`,
      `Renewal #: ${newRenewalCount}`,
    ].join("\n")
  );

  console.log(`Renewal #${newRenewalCount} processed for ${customerId} (row ${existing.rowIndex})`);
}

// =============================================================================
// Helpers
// =============================================================================

function getCustomerId(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

async function getCheckoutSession(
  subscriptionId: string
): Promise<Stripe.Checkout.Session | undefined> {
  const sessions = await stripe().checkout.sessions.list({
    subscription: subscriptionId,
    limit: 1,
  });
  return sessions.data[0];
}

function safeGetPlanType(priceId: string | undefined): string | null {
  if (!priceId) return null;
  try {
    return getPlanType(priceId);
  } catch {
    return null;
  }
}

async function determineChangeType(
  existing: ExistingSubscriber,
  newPlanType: string
): Promise<string> {
  // Returning customer with different plan: compare by quarterly amount via Stripe prices.
  // We look up both old and new prices via their plan-type → price-ID map (PRICE_TO_PLAN inverse).
  // Falls back to "Switched Plan" if amounts are equal or lookup fails.
  const oldPriceId = getPriceIdForPlan(existing.planType);
  const newPriceId = getPriceIdForPlan(newPlanType);
  if (!oldPriceId || !newPriceId) return "Switched Plan";

  try {
    const [oldPrice, newPrice] = await Promise.all([
      stripe().prices.retrieve(oldPriceId),
      stripe().prices.retrieve(newPriceId),
    ]);
    const oldAmount = oldPrice.unit_amount ?? 0;
    const newAmount = newPrice.unit_amount ?? 0;
    if (newAmount > oldAmount) return "Upgraded";
    if (newAmount < oldAmount) return "Downgraded";
    return "Switched Plan";
  } catch (err) {
    console.warn("determineChangeType price lookup failed:", err);
    return "Switched Plan";
  }
}

function parseRenewalCount(value: string): number {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed.toUpperCase() === "NA") return 0;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : 0;
}

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
