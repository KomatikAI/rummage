/** A dollar amount as Postgres `numeric(10,2)` arrives: a number, or a numeric string. */
export type MoneyAmount = number | string | null | undefined;

export interface FormatMoneyOptions {
  /** Drop ".00" on whole dollars, for price stickers: "$5" instead of "$5.00". */
  trimWholeDollars?: boolean;
  /** Show this label for exactly zero, for example "Free". */
  zeroLabel?: string;
}

const withCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Parses a dollar amount. Returns null when it is missing or not a finite number. */
export function toDollars(amount: MoneyAmount): number | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === "string" && amount.trim() === "") return null;
  const value = typeof amount === "number" ? amount : Number(amount.trim());
  if (!Number.isFinite(value)) return null;
  // Round to cents so 0.1 + 0.2 style drift never shows.
  return Math.round(value * 100) / 100;
}

/**
 * Formats dollars (not cents) as USD: 12.5 -> "$12.50", "1200" -> "$1,200.00".
 * Missing or invalid amounts render as an en dash.
 */
export function formatMoney(amount: MoneyAmount, options: FormatMoneyOptions = {}): string {
  const value = toDollars(amount);
  if (value === null) return "–";
  if (value === 0 && options.zeroLabel) return options.zeroLabel;
  const isWhole = Number.isInteger(value);
  const formatter = options.trimWholeDollars && isWhole ? wholeDollars : withCents;
  // Avoid "-$0.00" for tiny negative values that round to zero.
  return formatter.format(value === 0 ? 0 : value);
}
