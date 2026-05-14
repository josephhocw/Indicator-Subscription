import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";

// --- Column layout (matches Stripe Webhook Gameplan) ---
//
// A Email                       I Subscription Expiry
// B Customer Name               J Last Payment Date
// C TradingView Username        K Status              (ACTIVE | CANCELLED)
// D Telegram Username           L Latest Action       (see LatestAction below)
// E Telegram User ID            M Subscription Count
// F Plan Type                   N Failed Payment Count
// G Previous Plan Type          O Stripe Customer ID
// H Subscription Start          P Stripe Subscription ID

export type Status = "ACTIVE" | "CANCELLED";

export type LatestAction =
  | "NEW_SUBSCRIPTION"
  | "RENEWAL"
  | "UPGRADED"
  | "DOWNGRADED"
  | "PLAN_SWITCH"
  | "CANCELLED"
  | "REACTIVATED";

export const COL = {
  email: "A",
  customerName: "B",
  tradingViewUsername: "C",
  telegramUsername: "D",
  telegramUserId: "E",
  planType: "F",
  previousPlanType: "G",
  subscriptionStart: "H",
  subscriptionExpiry: "I",
  lastPaymentDate: "J",
  status: "K",
  latestAction: "L",
  subscriptionCount: "M",
  failedPaymentCount: "N",
  stripeCustomerId: "O",
  stripeSubscriptionId: "P",
} as const;

export type ColumnKey = keyof typeof COL;

export interface SheetRow {
  rowIndex: number; // 1-indexed (matches Sheets row numbering)
  email: string;
  customerName: string;
  tradingViewUsername: string;
  telegramUsername: string;
  telegramUserId: string;
  planType: string;
  previousPlanType: string;
  subscriptionStart: string;
  subscriptionExpiry: string;
  lastPaymentDate: string;
  status: string;
  latestAction: string;
  subscriptionCount: number;
  failedPaymentCount: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

export interface NewSubscriberRow {
  email: string;
  customerName: string;
  tradingViewUsername: string;
  telegramUsername: string;
  planType: string;
  subscriptionStart: string;
  subscriptionExpiry: string;
  lastPaymentDate: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

// Partial column update — pass any subset of ColumnKey -> string|number.
export type RowPatch = Partial<Record<ColumnKey, string | number>>;

// --- Auth & sheet config ---

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheets(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getAuth() });
}

const SHEET_ID = () => process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = () => process.env.GOOGLE_SHEET_TAB_NAME || "Subscribers";

// Assumes row 1 is a header row. Data rows start at row 2.
const DATA_RANGE = () => `${SHEET_NAME()}!A2:P`;

// --- Reads ---

function parseRow(row: string[], rowIndex: number): SheetRow {
  const cell = (i: number) => (row[i] ?? "").toString();
  const num = (i: number) => {
    const raw = cell(i).trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    rowIndex,
    email: cell(0),
    customerName: cell(1),
    tradingViewUsername: cell(2),
    telegramUsername: cell(3),
    telegramUserId: cell(4),
    planType: cell(5),
    previousPlanType: cell(6),
    subscriptionStart: cell(7),
    subscriptionExpiry: cell(8),
    lastPaymentDate: cell(9),
    status: cell(10),
    latestAction: cell(11),
    subscriptionCount: num(12),
    failedPaymentCount: num(13),
    stripeCustomerId: cell(14),
    stripeSubscriptionId: cell(15),
  };
}

async function getAllRows(): Promise<SheetRow[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: DATA_RANGE(),
  });
  const values = (res.data.values ?? []) as string[][];
  // rowIndex is 1-indexed; data starts at row 2.
  return values.map((row, i) => parseRow(row, i + 2));
}

export async function findRowByEmail(
  email: string
): Promise<SheetRow | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const rows = await getAllRows();
  return rows.find((r) => r.email.trim().toLowerCase() === target) ?? null;
}

export async function findRowBySubscriptionId(
  subscriptionId: string
): Promise<SheetRow | null> {
  if (!subscriptionId) return null;
  const rows = await getAllRows();
  return rows.find((r) => r.stripeSubscriptionId === subscriptionId) ?? null;
}

// --- Writes ---

export async function appendNewSubscriber(
  data: NewSubscriberRow
): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${SHEET_NAME()}!A:P`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          data.email,                  // A
          data.customerName,           // B
          data.tradingViewUsername,    // C
          data.telegramUsername,       // D
          "",                          // E — Telegram User ID (filled by bot.py)
          data.planType,               // F
          "",                          // G — Previous Plan Type
          data.subscriptionStart,      // H
          data.subscriptionExpiry,     // I
          data.lastPaymentDate,        // J
          "ACTIVE",                    // K — Status
          "NEW_SUBSCRIPTION",          // L — Latest Action
          1,                           // M — Renewal Count
          0,                           // N — Failed Payment Count
          data.stripeCustomerId,       // O
          data.stripeSubscriptionId,   // P
        ],
      ],
    },
  });
}

/**
 * Update a subset of columns on a row. Pass any subset of ColumnKey -> value.
 * Empty patch is a no-op.
 */
export async function updateRowFields(
  rowIndex: number,
  patch: RowPatch
): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const sheets = getSheets();
  const sheetName = SHEET_NAME();

  const data = entries.map(([key, value]) => ({
    range: `${sheetName}!${COL[key as ColumnKey]}${rowIndex}`,
    values: [[String(value)]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}
