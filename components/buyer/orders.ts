import type { CartStatus, PickupRow } from "@/lib/supabase/types";

/**
 * Pure helpers for the receipt and pickup screen: the outcome banner, per-unit status
 * and one card per household built from purchase units, cart lines and pickups.
 */

export type UnitPayment = "paid" | "checking" | "not_paid";

/** A purchase unit's capture_status (PayPal's, upper case) as the buyer sees it. */
export function unitPayment(captureStatus: string | null): UnitPayment {
  switch (captureStatus?.toUpperCase()) {
    case "COMPLETED":
    case "PARTIALLY_REFUNDED":
      return "paid";
    case "PENDING":
      return "checking";
    default:
      return "not_paid";
  }
}

export type OrderOutcome = "all_paid" | "partial" | "none" | "checking";

/**
 * The banner's outcome. The cart status is authoritative once it settles (paid, partial,
 * failed); before that the units decide, and a pending capture means "still checking".
 */
export function orderOutcome(cartStatus: CartStatus, units: readonly { captureStatus: string | null }[]): OrderOutcome {
  const sellerPayments = units.map((unit) => unitPayment(unit.captureStatus));
  if (sellerPayments.includes("checking")) return "checking";
  switch (cartStatus) {
    case "paid":
      return "all_paid";
    case "partial":
      return "partial";
    case "failed":
    case "abandoned":
      return "none";
    case "checkout":
      return "checking";
    case "open":
      return sellerPayments.length > 0 && sellerPayments.every((p) => p === "paid") ? "all_paid" : "none";
  }
}

export const OUTCOME_COPY: Record<OrderOutcome, { title: string; body: string }> = {
  all_paid: {
    title: "All paid",
    body: "Every table has your money. Show each code at its table to collect your things.",
  },
  partial: {
    title: "Some tables could not be paid",
    body: "The tables marked paid are yours to collect. Nothing was charged for the rest, and those items are free for others again.",
  },
  none: {
    title: "Nothing was paid",
    body: "No money moved. Your items went back on sale, so hold them again if you still want them.",
  },
  checking: {
    title: "Still checking",
    body: "The payment is still settling. This page shows your codes as soon as it clears.",
  },
};

export type ReceiptUnit = {
  householdId: string | null;
  amount: number;
  captureStatus: string | null;
};

export type ReceiptLine = { itemId: string; householdId: string; householdLabel: string; title: string; price: number };

export type ReceiptHousehold = {
  householdId: string;
  label: string;
  items: { itemId: string; title: string; price: number | null }[];
  /** The unit's amount, or the sum of line prices when no unit exists yet. */
  amount: number;
  payment: UnitPayment;
  pickupCode: string | null;
  /** Exact table position, only for paid units. */
  lng: number | null;
  lat: number | null;
};

export type DonationReceipt = { amount: number; payment: UnitPayment } | null;

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One card per household: units first (they carry the money and status), then lines
 * fill in the items, and pickups add the code and exact position for paid units.
 */
export function buildReceipt(input: {
  units: readonly ReceiptUnit[];
  lines: readonly ReceiptLine[];
  pickups: readonly PickupRow[];
}): { households: ReceiptHousehold[]; donation: DonationReceipt } {
  const households = new Map<string, ReceiptHousehold>();
  let donation: DonationReceipt = null;

  for (const unit of input.units) {
    if (unit.householdId === null) {
      donation = { amount: roundCents(unit.amount), payment: unitPayment(unit.captureStatus) };
      continue;
    }
    households.set(unit.householdId, {
      householdId: unit.householdId,
      label: "",
      items: [],
      amount: roundCents(unit.amount),
      payment: unitPayment(unit.captureStatus),
      pickupCode: null,
      lng: null,
      lat: null,
    });
  }

  const hadUnits = households.size > 0;
  for (const line of input.lines) {
    let household = households.get(line.householdId);
    if (!household) {
      if (hadUnits) continue; // a line without a unit was released before checkout
      household = {
        householdId: line.householdId,
        label: line.householdLabel,
        items: [],
        amount: 0,
        payment: "not_paid",
        pickupCode: null,
        lng: null,
        lat: null,
      };
      households.set(line.householdId, household);
    }
    if (!hadUnits) household.amount = roundCents(household.amount + line.price);
    if (!household.label) household.label = line.householdLabel;
    if (!household.items.some((item) => item.itemId === line.itemId)) {
      household.items.push({ itemId: line.itemId, title: line.title, price: line.price });
    }
  }

  for (const pickup of input.pickups) {
    const household = households.get(pickup.household_id);
    if (!household) continue;
    household.label = household.label || pickup.household_label;
    household.pickupCode = household.pickupCode ?? pickup.pickup_code;
    if (household.lng === null && pickup.exact_lng !== null && pickup.exact_lat !== null) {
      household.lng = pickup.exact_lng;
      household.lat = pickup.exact_lat;
    }
    if (!household.items.some((item) => item.itemId === pickup.item_id)) {
      household.items.push({ itemId: pickup.item_id, title: pickup.item_title, price: null });
    }
  }

  return {
    households: [...households.values()].map((household) => ({
      ...household,
      label: household.label || "A table at this sale",
    })),
    donation,
  };
}

export const PAYMENT_BADGE: Record<UnitPayment, { status: "ready" | "pending" | "sold"; label: string }> = {
  paid: { status: "ready", label: "Paid" },
  checking: { status: "pending", label: "Checking" },
  not_paid: { status: "sold", label: "Not paid" },
};
