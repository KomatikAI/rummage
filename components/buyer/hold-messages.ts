import type { HoldItemResult, ReleaseHoldResult } from "@/lib/supabase/types";

/**
 * Plain sentences for every hold_item / release_hold result, and the shape the hold
 * and release server actions return to the page.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export type HoldContext = {
  /** maxHouseholdsPerCart(sale.fundraiser_name). */
  maxHouseholds: number;
};

function tables(count: number): string {
  return count === 1 ? "1 table" : `${count} tables`;
}

export function holdResultMessage(result: HoldItemResult, context: HoldContext): ActionResult {
  switch (result) {
    case "held":
      return { ok: true, message: "It is yours for 15 minutes. Pay from your cart before the time runs out." };
    case "cap_reached":
      return {
        ok: false,
        message: `You can shop up to ${tables(context.maxHouseholds)} in one order. Pay for this cart first, then start another.`,
      };
    case "seller_not_ready":
      return {
        ok: false,
        message: "This table is not set up for checkout yet. Ask the seller, or come back a little later.",
      };
    case "already_held":
      return {
        ok: false,
        message: "Someone else is holding this one right now. It comes back if they do not pay within 15 minutes.",
      };
    case "sold":
      return { ok: false, message: "This one has already sold." };
    case "own_item":
      return { ok: false, message: "This is one of your own items, so you cannot hold it." };
    case "not_found":
      return { ok: false, message: "This item is no longer listed. Pick another one." };
    case "cart_not_open":
      return {
        ok: false,
        message: "Your cart is at checkout right now. Finish paying first, then you can add more.",
      };
    case "not_allowed":
      return { ok: false, message: "We could not hold this item. Sign in again and try once more." };
  }
}

export function releaseResultMessage(result: ReleaseHoldResult): ActionResult {
  switch (result) {
    case "released":
      return { ok: true, message: "Removed from your cart. Someone else can buy it now." };
    case "not_held":
      return { ok: true, message: "That item was no longer in your cart." };
    case "cart_not_open":
      return {
        ok: false,
        message: "Your cart is at checkout, so items cannot be removed right now.",
      };
    case "not_found":
      return { ok: false, message: "We could not find that item. Refresh the page and try again." };
    case "not_allowed":
      return { ok: false, message: "We could not change this cart. Sign in again and try once more." };
  }
}

/** For a signed-out tap on "Hold for 15 minutes". */
export function signInHref(next: string): string {
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
