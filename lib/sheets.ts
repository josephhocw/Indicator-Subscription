import { google } from "googleapis";

export interface SubscriberData {
  email: string;
  customerName: string;
  tradingViewUsername: string;
  telegramUsername: string;
  planType: string;
  subscriptionStart: string;
  subscriptionExpiry: string;
  stripeCustomerId: string;
}

export interface ExistingSubscriber {
  rowIndex: number; // 1-indexed Sheets row
  email: string;
  customerName: string;
  tradingViewUsername: string;
  telegramUsername: string;
  telegramUserId: string;
  planType: string;
  subscriptionStart: string;
  subscriptionExpiry: string;
  status: string;
  stripeCustomerId: string;
  previousPlanType: string;
  renewalCount: string;
  changeType: string;
}

export interface SubscriberFieldUpdate {
  email?: string;
  customerName?: string;
  tradingViewUsername?: string;
  telegramUsername?: string;
  planType?: string;
  subscriptionStart?: string;
  subscriptionExpiry?: string;
  status?: string;
  stripeCustomerId?: string;
  previousPlanType?: string;
  renewalCount?: string;
  changeType?: string;
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
    range: `${SHEET_NAME}!A:M`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          data.email,                 // A - Email
          data.customerName,          // B - Customer Name
          data.tradingViewUsername,   // C - TradingView Username
          data.telegramUsername,      // D - Telegram Username
          "",                         // E - Telegram User ID (written by bot)
          data.planType,              // F - Plan Type
          data.subscriptionStart,     // G - Subscription Start
          data.subscriptionExpiry,    // H - Subscription Expiry
          "ACTIVE",                   // I - Status
          data.stripeCustomerId,      // J - Stripe Customer ID
          "",                         // K - Previous Plan Type
          "",                         // L - Renewal Count
          "",                         // M - Change Type
        ],
      ],
    },
  });
}

function rowToSubscriber(row: string[], rowIndex: number): ExistingSubscriber {
  return {
    rowIndex,
    email: row[0] || "",
    customerName: row[1] || "",
    tradingViewUsername: row[2] || "",
    telegramUsername: row[3] || "",
    telegramUserId: row[4] || "",
    planType: row[5] || "",
    subscriptionStart: row[6] || "",
    subscriptionExpiry: row[7] || "",
    status: row[8] || "",
    stripeCustomerId: row[9] || "",
    previousPlanType: row[10] || "",
    renewalCount: row[11] || "",
    changeType: row[12] || "",
  };
}

async function readAllRows(): Promise<string[][]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${SHEET_NAME}!A:M`,
  });
  return res.data.values || [];
}

/**
 * Find a subscriber row by identity criteria.
 * Match priority: email > tradingview username > telegram username > stripe customer ID.
 * First hit (top-down) wins. Skips header row (row 1).
 * Comparisons are case-insensitive and trim whitespace.
 */
export async function findSubscriberRow(criteria: {
  email?: string;
  tvUsername?: string;
  tgUsername?: string;
  customerId?: string;
}): Promise<ExistingSubscriber | null> {
  const rows = await readAllRows();
  if (rows.length <= 1) return null;

  const norm = (v: string | undefined) => (v || "").trim().toLowerCase();
  const email = norm(criteria.email);
  const tv = norm(criteria.tvUsername);
  const tg = norm(criteria.tgUsername);
  const cust = norm(criteria.customerId);

  const matchers: Array<(row: string[]) => boolean> = [];
  if (email) matchers.push((row) => norm(row[0]) === email);
  if (tv) matchers.push((row) => norm(row[2]) === tv);
  if (tg) matchers.push((row) => norm(row[3]) === tg);
  if (cust) matchers.push((row) => norm(row[9]) === cust);

  for (const matcher of matchers) {
    for (let i = 1; i < rows.length; i++) {
      if (matcher(rows[i])) {
        return rowToSubscriber(rows[i], i + 1);
      }
    }
  }
  return null;
}

export async function findSubscriberByCustomerId(
  customerId: string
): Promise<ExistingSubscriber | null> {
  return findSubscriberRow({ customerId });
}

const COLUMN_INDEX: Record<keyof SubscriberFieldUpdate, number> = {
  email: 0,
  customerName: 1,
  tradingViewUsername: 2,
  telegramUsername: 3,
  planType: 5,
  subscriptionStart: 6,
  subscriptionExpiry: 7,
  status: 8,
  stripeCustomerId: 9,
  previousPlanType: 10,
  renewalCount: 11,
  changeType: 12,
};

const COLUMN_LETTER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];

export async function updateSubscriberRow(
  rowIndex: number,
  updates: SubscriberFieldUpdate
): Promise<void> {
  const entries = Object.entries(updates) as Array<
    [keyof SubscriberFieldUpdate, string | undefined]
  >;
  if (entries.length === 0) return;

  const data = entries
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => {
      const col = COLUMN_LETTER[COLUMN_INDEX[field]];
      return {
        range: `${SHEET_NAME}!${col}${rowIndex}`,
        values: [[value as string]],
      };
    });

  if (data.length === 0) return;

  const sheets = getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

export async function updateStatusByCustomerId(
  customerId: string,
  status: "ACTIVE" | "CANCELLED" | "EXPIRED"
): Promise<ExistingSubscriber | null> {
  const existing = await findSubscriberByCustomerId(customerId);
  if (!existing) {
    throw new Error(`Customer ${customerId} not found in sheet`);
  }
  await updateSubscriberRow(existing.rowIndex, { status });
  return { ...existing, status };
}
