import { google } from "googleapis";

export interface SubscriberData {
  email: string;
  customerName: string;
  tradingViewUsername: string;
  telegramUsername: string;
  planType: string;
  subscriptionStart: string; // ISO YYYY-MM-DD
  subscriptionExpiry: string; // ISO YYYY-MM-DD
  stripeCustomerId: string;
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheets() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

const SHEET_ID = () => process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = "TestSheet"; //Demo sheet name, change as needed

export async function appendSubscriber(data: SubscriberData): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${SHEET_NAME}!A:L`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          data.email,                // A - Email
          data.customerName,         // B - Customer Name
          data.tradingViewUsername,   // C - TradingView Username
          data.telegramUsername,      // D - Telegram Username
          "",                        // E - Telegram User ID (written by bot)
          data.planType,             // F - Plan Type
          data.subscriptionStart,    // G - Subscription Start
          data.subscriptionExpiry,   // H - Subscription Expiry
          "ACTIVE",                  // I - Status
          data.stripeCustomerId,     // J - Stripe Customer ID
          "NO",                       // K - Previous Plan Type
          "0",                       // L - Renewal Count
        ],
      ],
    },
  });
}

export async function updateStatusByCustomerId(
  customerId: string,
  status: "ACTIVE" | "CANCELLED" | "EXPIRED"
): Promise<void> {
  const sheets = getSheets();
  const spreadsheetId = SHEET_ID();

  // Read column J (Stripe Customer ID) to find the row
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!J:J`,
  });

  const rows = res.data.values;
  if (!rows) throw new Error("Sheet is empty");

  const rowIndex = rows.findIndex((row) => row[0] === customerId);
  if (rowIndex === -1) {
    throw new Error(`Customer ${customerId} not found in sheet`);
  }

  // Update column I (Status) — row is 1-indexed in Sheets
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!I${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[status]],
    },
  });
}
