import { Resend } from "resend";
import {
  getMarketLinks,
  getPlanDisplayName,
  parsePlanType,
  MAIN_CHANNEL_LINK,
  BILLING_PORTAL_LINK,
  type MarketLink,
} from "./plans.js";

const resend = () => new Resend(process.env.RESEND_API_KEY!);

export async function sendOnboardingEmail(
  email: string,
  name: string,
  planType: string
): Promise<void> {
  const marketLinks = getMarketLinks(planType);
  const planName = getPlanDisplayName(planType);
  const { category } = parsePlanType(planType);

  const telegramButtonsHtml = generateTelegramButtons(marketLinks, category);
  const telegramButtonsText = marketLinks
    .map((m) => `  - Join ${m.displayName}: ${m.url}`)
    .join("\n");

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <h2 style="color:#1a1a1a">Welcome to RHO Market Navigator</h2>
  <p>Hi ${name},</p>
  <p>Thank you for subscribing to the <strong>${planName}</strong> plan.</p>
  <p>Your account is now active. Here's how to get started:</p>

  <h3 style="color:#1a1a1a">1. Join your Telegram groups</h3>
  <p>Click the buttons below to join your signal channels:</p>
  ${telegramButtonsHtml}

  <br/>
  <p>Also join our main announcements channel:</p>
  ${makeButton("Join Main Channel", MAIN_CHANNEL_LINK)}

  <h3 style="color:#1a1a1a">2. Set up TradingView</h3>
  <p>We will grant indicator access to your TradingView account within 24 hours.
     You will receive a notification on TradingView once access is granted.</p>

  <h3 style="color:#1a1a1a">3. Manage your subscription</h3>
  <p>You can manage billing, update payment methods, or cancel anytime:</p>
  ${makeButton("Billing Portal", BILLING_PORTAL_LINK, "#555")}

  <h3 style="color:#1a1a1a">4. Need help?</h3>
  <p>Reply to this email or message us on Telegram if you have any questions.</p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
  <p style="font-size:12px;color:#999">RHO Market Navigator</p>
</div>`.trim();

  const text = `Welcome to RHO Market Navigator

Hi ${name},

Thank you for subscribing to the ${planName} plan.
Your account is now active.

1. Join your Telegram groups:
${telegramButtonsText}
  - Main Channel: ${MAIN_CHANNEL_LINK}

2. Set up TradingView
We will grant indicator access to your TradingView account within 24 hours.

3. Manage your subscription
Billing Portal: ${BILLING_PORTAL_LINK}

4. Need help?
Reply to this email or message us on Telegram.

-- RHO Market Navigator`;

  await resend().emails.send({
    from: process.env.FROM_EMAIL!,
    to: email,
    subject: `Welcome to RHO Market Navigator - ${planName}`,
    html,
    text,
  });
}

// --- Button HTML generators (table-based for email client compatibility) ---

function makeButton(label: string, href: string, color = "#0088cc"): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="border-radius:5px;background-color:${color}">
      <a href="${href}" target="_blank" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;min-width:200px;text-align:center">Join ${label}</a>
    </td>
  </tr>
</table>`;
}

function generateTelegramButtons(
  markets: MarketLink[],
  category: string
): string {
  if (category === "single") {
    return makeButton(markets[0].displayName, markets[0].url);
  }

  if (category === "combo" && markets.length === 2) {
    // Side-by-side
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    ${markets
      .map(
        (m, i) =>
          `<td style="${i === 0 ? "padding-right:10px" : ""}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-radius:5px;background-color:#0088cc">
            <a href="${m.url}" target="_blank" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;min-width:180px;text-align:center">Join ${m.displayName}</a>
          </td>
        </tr>
      </table>
    </td>`
      )
      .join("\n    ")}
  </tr>
</table>`;
  }

  if (category === "combo" && markets.length === 3) {
    // Three in a row
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    ${markets
      .map(
        (m, i) =>
          `<td style="${i < 2 ? "padding-right:10px;" : ""}padding-bottom:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-radius:5px;background-color:#0088cc">
            <a href="${m.url}" target="_blank" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;min-width:180px;text-align:center">Join ${m.displayName}</a>
          </td>
        </tr>
      </table>
    </td>`
      )
      .join("\n    ")}
  </tr>
</table>`;
  }

  if (category === "all" && markets.length === 4) {
    // 2x2 grid
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    ${markets
      .slice(0, 2)
      .map(
        (m, i) =>
          `<td style="${i === 0 ? "padding-right:10px;" : ""}padding-bottom:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-radius:5px;background-color:#0088cc">
            <a href="${m.url}" target="_blank" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;min-width:180px;text-align:center">Join ${m.displayName}</a>
          </td>
        </tr>
      </table>
    </td>`
      )
      .join("\n    ")}
  </tr>
  <tr>
    ${markets
      .slice(2, 4)
      .map(
        (m, i) =>
          `<td style="${i === 0 ? "padding-right:10px" : ""}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-radius:5px;background-color:#0088cc">
            <a href="${m.url}" target="_blank" style="display:block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;min-width:180px;text-align:center">Join ${m.displayName}</a>
          </td>
        </tr>
      </table>
    </td>`
      )
      .join("\n    ")}
  </tr>
</table>`;
  }

  // Fallback: stacked vertically
  return markets
    .map((m) => makeButton(m.displayName, m.url))
    .join('<div style="height:10px"></div>');
}
