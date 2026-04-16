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

export interface OnboardingEmailData {
  email: string;
  name: string;
  planType: string;
  tvUsername: string;
  telegramUsername: string;
  billingEndDate: string; // formatted display date
}

export async function sendOnboardingEmail(
  data: OnboardingEmailData
): Promise<void> {
  const { email, name, planType, tvUsername, telegramUsername, billingEndDate } =
    data;
  const marketLinks = getMarketLinks(planType);
  const planName = getPlanDisplayName(planType);
  const { category } = parsePlanType(planType);
  const telegramButtonsHtml = generateTelegramButtons(marketLinks, category);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to RHO Navigator</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px;">

                    <!-- Header -->
                    <tr>
                        <td style="padding: 30px 30px 20px 30px; text-align: center;">
                            <h1 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px; font-weight: normal;">Welcome to RHO Navigator</h1>
                            <p style="margin: 0; color: #666; font-size: 16px;">Hi ${name},</p>
                            <p style="margin: 10px 0 0 0; color: #666; font-size: 16px;">Your ${planName} subscription is now active.</p>
                        </td>
                    </tr>

                    <!-- Step 1: Announcement Channel -->
                    <tr>
                        <td style="padding: 15px 30px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid #4CAF50;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h2 style="margin: 0 0 12px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">STEP 1: Join Our Announcement Channel</h2>
                                        <p style="margin: 0 0 15px 0; color: #666; font-size: 14px; line-height: 1.6;">Start here to get guides, updates, and resources.</p>
                                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                            <tr>
                                                <td style="border-radius: 5px; background-color: #0088cc;">
                                                    <a href="${MAIN_CHANNEL_LINK}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; text-align: center;">Join Announcement Channel</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Step 2: Telegram Signal Groups -->
                    <tr>
                        <td style="padding: 15px 30px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid #2196F3;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h2 style="margin: 0 0 12px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">STEP 2: Join these Telegram Group(s) for your live signals!</h2>
                                        <p style="margin: 0 0 15px 0; color: #666; font-size: 14px; line-height: 1.6;">Get real-time trading signals for your markets:</p>
                                        ${telegramButtonsHtml}
                                        <div style="margin-top: 15px; padding: 12px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                                            <p style="margin: 0; color: #666; font-size: 13px;"><strong>Important:</strong> Our bot will verify your username: <strong>${telegramUsername || "(not provided)"}</strong></p>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Step 3: TradingView -->
                    <tr>
                        <td style="padding: 15px 30px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid #9C27B0;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h2 style="margin: 0 0 12px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">STEP 3: TradingView Indicator Access</h2>
                                        <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; line-height: 1.6;">We will send you an invite within 1 business day.</p>
                                        <div style="padding: 10px; background-color: #ffffff; border-radius: 4px;">
                                            <p style="margin: 0; color: #666; font-size: 13px;"><strong>Your TradingView username:</strong> ${tvUsername || "(not provided)"}</p>
                                        </div>
                                        <p style="margin: 10px 0 0 0; color: #999; font-size: 13px;">Check your TradingView account tomorrow to access the indicator.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Subscription Details -->
                    <tr>
                        <td style="padding: 15px 30px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 6px; border: 1px solid #e0e0e0;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h2 style="margin: 0 0 12px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">Your Subscription Details</h2>
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                            <tr>
                                                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                                                    <span style="color: #666; font-size: 14px;"><strong>Plan:</strong> ${planName}</span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 6px 0; border-bottom: 1px solid #e0e0e0;">
                                                    <span style="color: #666; font-size: 14px;"><strong>Status:</strong> <span style="color: #4CAF50; font-weight: bold;">Active</span></span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 6px 0;">
                                                    <span style="color: #666; font-size: 14px;"><strong>Next Billing:</strong> ${billingEndDate}</span>
                                                </td>
                                            </tr>
                                        </table>
                                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top: 15px;">
                                            <tr>
                                                <td align="center" style="border-radius: 5px; background-color: #FF9800;">
                                                    <a href="${BILLING_PORTAL_LINK}" target="_blank" style="display: inline-block; padding: 10px 20px; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: bold;">Manage Subscription</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px; text-align: center; border-top: 2px solid #e0e0e0;">
                            <p style="margin: 0 0 10px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">Happy Trading</p>
                            <p style="margin: 0; color: #999; font-size: 13px;">Need help? Contact support at <a href="https://t.me/Joseph_Ho" style="color: #0088cc; text-decoration: none;">@Joseph_Ho</a></p>
                            <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">RHO Market Navigator | Trading Signals Service</p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

  const text = `Welcome to RHO Navigator

Hi ${name},
Your ${planName} subscription is now active.

STEP 1: Join Our Announcement Channel
${MAIN_CHANNEL_LINK}

STEP 2: Join your Telegram Signal Groups
${marketLinks.map((m) => `- ${m.displayName}: ${m.url}`).join("\n")}
Important: Our bot will verify your username: ${telegramUsername || "(not provided)"}

STEP 3: TradingView Indicator Access
We will send you an invite within 1 business day.
Your TradingView username: ${tvUsername || "(not provided)"}

Subscription Details:
- Plan: ${planName}
- Status: Active
- Next Billing: ${billingEndDate}
- Manage: ${BILLING_PORTAL_LINK}

Happy Trading!
Need help? Contact @Joseph_Ho on Telegram
RHO Market Navigator | Trading Signals Service`;

  await resend().emails.send({
    from: process.env.FROM_EMAIL!,
    to: email,
    bcc: process.env.BCC_EMAIL,
    subject: `Welcome to RHO Navigator - ${planName}`,
    html,
    text,
  });
}

// --- Telegram button HTML generators ---

function generateTelegramButtons(
  markets: MarketLink[],
  category: string
): string {
  if (category === "single") {
    return singleButton(markets[0]);
  }
  if (category === "combo" && markets.length === 2) {
    return sideBySideButtons(markets);
  }
  if (category === "combo" && markets.length === 3) {
    return threeButtonRow(markets);
  }
  if (category === "all" && markets.length === 4) {
    return twoByTwoGrid(markets);
  }
  // Fallback: stacked
  return markets.map((m) => singleButton(m)).join("");
}

function singleButton(market: MarketLink): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td style="border-radius: 5px; background-color: #0088cc;">
            <a href="${market.url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 200px; text-align: center;">Join ${market.displayName}</a>
        </td>
    </tr>
</table>`;
}

function sideBySideButtons(markets: MarketLink[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td style="padding-right: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[0].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[0].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
        <td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[1].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[1].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}

function threeButtonRow(markets: MarketLink[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td style="padding-right: 10px; padding-bottom: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[0].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[0].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
        <td style="padding-right: 10px; padding-bottom: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[1].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[1].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
        <td style="padding-bottom: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[2].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[2].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}

function twoByTwoGrid(markets: MarketLink[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td style="padding-right: 10px; padding-bottom: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[0].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[0].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
        <td style="padding-bottom: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[1].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[1].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
    <tr>
        <td style="padding-right: 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[2].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[2].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
        <td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td style="border-radius: 5px; background-color: #0088cc;">
                        <a href="${markets[3].url}" target="_blank" style="display: block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: bold; min-width: 180px; text-align: center;">Join ${markets[3].displayName}</a>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>`;
}
