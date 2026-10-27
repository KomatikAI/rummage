import { fromCents } from "@/lib/paypal/money";
import { maxHouseholdsPerCart, type PayPalLinkStatus } from "@/lib/supabase/types";

/**
 * Pure: turns a cart's active lines into PayPal purchase units, one per household
 * (reference_id = household id, payee = that household's merchant id), plus the
 * optional donation unit to the sale organizer.
 */

/** reference_id (and custom_id) of the donation unit. Household units use the household id. */
export const DONATION_REFERENCE_ID = "donation";

/** Largest donation accepted at checkout, in cents ($1,000.00). */
export const MAX_DONATION_CENTS = 100_000;

const MAX_ITEM_NAME = 127;

export type CheckoutLine = { item_id: string; household_id: string; price: number };
export type CheckoutItem = { id: string; title: string };
export type CheckoutHousehold = {
  id: string;
  label: string;
  merchant_id_in_paypal: string | null;
  paypal_status: PayPalLinkStatus;
  paused: boolean;
};
export type CheckoutSale = { fundraiser_name: string | null; organizer_merchant_id: string | null };

export type CheckoutUnitItem = { name: string; quantity: number; unitAmount: string; sku: string };

export type CheckoutUnit = {
  referenceId: string;
  /** null for the donation unit. */
  householdId: string | null;
  merchantId: string;
  amountCents: number;
  /** Two-decimal string, e.g. "12.50". */
  amount: string;
  items: CheckoutUnitItem[];
  description: string;
};

export type BuildUnitsError = {
  ok: false;
  status: 400 | 409;
  code:
    | "cart_empty"
    | "seller_not_ready"
    | "too_many_households"
    | "donations_not_accepted"
    | "item_not_payable";
  message: string;
};

export type BuildUnitsResult = { ok: true; units: CheckoutUnit[] } | BuildUnitsError;

/** numeric(10,2) from PostgREST arrives as a number; round to whole cents. */
export function toCentsFromNumber(value: number): number {
  return Math.round(value * 100);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

export function buildCheckoutUnits(input: {
  lines: CheckoutLine[];
  items: CheckoutItem[];
  households: CheckoutHousehold[];
  sale: CheckoutSale;
  donationCents: number;
}): BuildUnitsResult {
  const { lines, sale, donationCents } = input;
  if (lines.length === 0) {
    return { ok: false, status: 409, code: "cart_empty", message: "The cart has no items." };
  }

  const titles = new Map(input.items.map((item) => [item.id, item.title]));
  const households = new Map(input.households.map((household) => [household.id, household]));

  // Group lines per household, keeping the order households first appear in the cart.
  const grouped = new Map<string, CheckoutLine[]>();
  for (const line of lines) {
    const group = grouped.get(line.household_id);
    if (group) group.push(line);
    else grouped.set(line.household_id, [line]);
  }

  const cap = maxHouseholdsPerCart(sale.fundraiser_name);
  if (grouped.size > cap) {
    return {
      ok: false,
      status: 409,
      code: "too_many_households",
      message: `A cart can hold items from at most ${cap} sellers at this sale.`,
    };
  }

  const units: CheckoutUnit[] = [];
  for (const [householdId, householdLines] of grouped) {
    const household = households.get(householdId);
    if (
      !household ||
      household.paused ||
      household.paypal_status !== "ready" ||
      !household.merchant_id_in_paypal
    ) {
      return {
        ok: false,
        status: 409,
        code: "seller_not_ready",
        message: "One of the sellers in this cart cannot take PayPal payments right now.",
      };
    }
    const items: CheckoutUnitItem[] = [];
    let totalCents = 0;
    for (const line of householdLines) {
      const cents = toCentsFromNumber(line.price);
      if (cents <= 0) {
        return {
          ok: false,
          status: 409,
          code: "item_not_payable",
          message: "Every item in the cart needs a price above zero.",
        };
      }
      totalCents += cents;
      items.push({
        name: truncate(titles.get(line.item_id) ?? "Rummage item", MAX_ITEM_NAME),
        quantity: 1,
        unitAmount: fromCents(cents),
        sku: line.item_id,
      });
    }
    units.push({
      referenceId: householdId,
      householdId,
      merchantId: household.merchant_id_in_paypal,
      amountCents: totalCents,
      amount: fromCents(totalCents),
      items,
      description: truncate(household.label, MAX_ITEM_NAME),
    });
  }

  if (donationCents > 0) {
    if (!sale.fundraiser_name || !sale.organizer_merchant_id) {
      return {
        ok: false,
        status: 400,
        code: "donations_not_accepted",
        message: "This sale does not take donations.",
      };
    }
    const amount = fromCents(donationCents);
    const name = truncate(`Donation to ${sale.fundraiser_name}`, MAX_ITEM_NAME);
    units.push({
      referenceId: DONATION_REFERENCE_ID,
      householdId: null,
      merchantId: sale.organizer_merchant_id,
      amountCents: donationCents,
      amount,
      items: [{ name, quantity: 1, unitAmount: amount, sku: DONATION_REFERENCE_ID }],
      description: name,
    });
  }

  return { ok: true, units };
}
