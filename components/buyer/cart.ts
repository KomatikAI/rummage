/**
 * Pure cart maths for /buyer/cart: lines grouped by household, hold countdowns,
 * donation parsing and totals. Money is dollars on the page and whole cents on the wire
 * (create-order takes `donationCents`).
 */

export type CartItemLine = {
  itemId: string;
  householdId: string;
  householdLabel: string;
  title: string;
  /** Dollars. */
  price: number;
  /** ISO timestamp. */
  holdExpiresAt: string;
  photoUrl: string | null;
};

export type HouseholdGroup = {
  householdId: string;
  label: string;
  lines: CartItemLine[];
  /** Dollars, rounded to cents. */
  subtotal: number;
};

export function roundCents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}

/** Groups lines by household in first-seen order, with a subtotal each. */
export function groupByHousehold(lines: readonly CartItemLine[]): HouseholdGroup[] {
  const groups = new Map<string, HouseholdGroup>();
  for (const line of lines) {
    let group = groups.get(line.householdId);
    if (!group) {
      group = { householdId: line.householdId, label: line.householdLabel, lines: [], subtotal: 0 };
      groups.set(line.householdId, group);
    }
    group.lines.push(line);
    group.subtotal = roundCents(group.subtotal + line.price);
  }
  return [...groups.values()];
}

export function cartSubtotal(lines: readonly { price: number }[]): number {
  return roundCents(lines.reduce((sum, line) => sum + line.price, 0));
}

/** Lines whose hold is still running at `nowMs` (an open cart drops expired holds). */
export function liveLines<T extends { holdExpiresAt: string }>(lines: readonly T[], nowMs: number): T[] {
  return lines.filter((line) => Date.parse(line.holdExpiresAt) > nowMs);
}

/** The earliest hold expiry, or null with no lines. */
export function earliestExpiry(lines: readonly { holdExpiresAt: string }[]): string | null {
  let earliest: { iso: string; ms: number } | null = null;
  for (const line of lines) {
    const ms = Date.parse(line.holdExpiresAt);
    if (Number.isNaN(ms)) continue;
    if (!earliest || ms < earliest.ms) earliest = { iso: line.holdExpiresAt, ms };
  }
  return earliest?.iso ?? null;
}

/** Whole seconds left until `expiresAt`, never negative. */
export function secondsLeft(expiresAt: string, nowMs: number): number {
  const ms = Date.parse(expiresAt) - nowMs;
  if (Number.isNaN(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

/** 754 -> "12:34", 5 -> "0:05". */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Spoken form for screen readers: "12 minutes 34 seconds". */
export function countdownLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  if (rest > 0 || minutes === 0) parts.push(rest === 1 ? "1 second" : `${rest} seconds`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- donation

/** Preset donations in dollars. "custom" opens a field. */
export const DONATION_PRESETS = [0, 5, 10] as const;
export type DonationChoice = (typeof DONATION_PRESETS)[number] | "custom";

/** Mirrors MAX_DONATION_CENTS in lib/checkout/order-units.ts ($1,000.00). */
export const MAX_DONATION_DOLLARS = 1000;

export type DonationParse = { ok: true; cents: number } | { ok: false; message: string };

/**
 * Parses a typed donation such as "7", "$7.50" or "1,000". Empty means no donation.
 * At most two decimals, never negative, at most $1,000.
 */
export function parseDonation(input: string): DonationParse {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (cleaned === "") return { ok: true, cents: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned) && !/^\.\d{1,2}$/.test(cleaned)) {
    return { ok: false, message: "Enter an amount in dollars, like 5 or 7.50." };
  }
  const cents = Math.round(Number(cleaned) * 100);
  if (cents > MAX_DONATION_DOLLARS * 100) {
    return { ok: false, message: "Donations at checkout go up to $1,000." };
  }
  return { ok: true, cents };
}

/** The donation in cents for a preset or a custom amount. */
export function donationCents(choice: DonationChoice, customInput: string): DonationParse {
  if (choice === "custom") return parseDonation(customInput);
  return { ok: true, cents: choice * 100 };
}

/** Items plus donation, in dollars. */
export function grandTotal(subtotal: number, donationCentsValue: number): number {
  return roundCents(subtotal + donationCentsValue / 100);
}
