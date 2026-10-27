import type { HouseholdRow } from "@/lib/supabase/types";

/**
 * Plain-language copy and small decisions for the seller pages: which household to
 * show, what the PayPal card says, and how errors read.
 */

// ---------------------------------------------------------------------------
// Which household
// ---------------------------------------------------------------------------

/**
 * The household a seller page shows: the one named in `?household=` when the seller
 * owns it, else the newest. `households` must already be limited to the seller's own.
 */
export function pickHousehold<T extends Pick<HouseholdRow, "id" | "created_at">>(
  households: readonly T[],
  requestedId: string | null | undefined,
): T | null {
  if (households.length === 0) return null;
  if (requestedId) {
    const requested = households.find((household) => household.id === requestedId);
    if (requested) return requested;
  }
  return [...households].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/** A query string that keeps the chosen household across seller pages. */
export function householdQuery(householdId: string): string {
  return `?household=${encodeURIComponent(householdId)}`;
}

/** The first value of a search param. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// ---------------------------------------------------------------------------
// PayPal link card
// ---------------------------------------------------------------------------

export type PayPalCardState = "unlinked" | "pending" | "ready";

export type PayPalCardView = {
  state: PayPalCardState;
  title: string;
  body: string;
  /** What PayPal still needs, one short sentence each. Empty unless pending. */
  missing: string[];
  /** Label for the link button, or null when there is nothing to do. */
  action: string | null;
};

type LinkFields = Pick<HouseholdRow, "paypal_status" | "paypal_payments_receivable" | "paypal_email_confirmed">;

export function paypalCardView(household: LinkFields): PayPalCardView {
  switch (household.paypal_status) {
    case "ready":
      return {
        state: "ready",
        title: "PayPal is linked",
        body: "Buyers can pay you for your items. Money goes straight to your PayPal account.",
        missing: [],
        action: null,
      };
    case "pending": {
      const missing: string[] = [];
      if (household.paypal_email_confirmed === false) {
        missing.push("Confirm your email address. PayPal sent you a message with a link.");
      }
      if (household.paypal_payments_receivable === false) {
        missing.push("Your PayPal account cannot take payments yet. Log in to PayPal and clear any notice there.");
      }
      if (missing.length === 0) {
        missing.push("We are still checking your account with PayPal. This can take a few minutes.");
      }
      return {
        state: "pending",
        title: "PayPal needs a little more",
        body: "Buyers can see your items, but they cannot pay until PayPal is finished.",
        missing,
        action: "Finish linking PayPal",
      };
    }
    case "revoked":
      return {
        state: "unlinked",
        title: "PayPal is no longer linked",
        body: "The link to your PayPal account was removed. Link it again so buyers can pay you.",
        missing: [],
        action: "Link PayPal",
      };
    case "unlinked":
      return {
        state: "unlinked",
        title: "Link PayPal to get paid",
        body: "Buyers pay you through PayPal. It takes a few minutes and you come straight back here.",
        missing: [],
        action: "Link PayPal",
      };
  }
}

/** The one-line notice after PayPal sends the seller back, or null. */
export function onboardingNotice(
  onboarding: string | undefined,
  returnedHouseholdId: string | undefined,
  shownHouseholdId: string,
): { tone: "ready" | "pending"; text: string } | null {
  if (returnedHouseholdId !== undefined && returnedHouseholdId !== shownHouseholdId) return null;
  if (onboarding === "ready") return { tone: "ready", text: "Welcome back. PayPal is linked and buyers can pay you now." };
  if (onboarding === "pending") {
    return { tone: "pending", text: "Welcome back. PayPal needs a little more from you before buyers can pay. See below." };
  }
  return null;
}

/** What to say when the PayPal sign-up link could not be made. */
export function partnerReferralErrorMessage(status: number): string {
  if (status === 401) return "Your session ended. Sign in again, then link PayPal.";
  if (status === 403 || status === 404) return "We could not find your table. Reload the page and try again.";
  return "We could not reach PayPal just now. Try again in a minute.";
}

// ---------------------------------------------------------------------------
// Errors from the database and the pricing route
// ---------------------------------------------------------------------------

type DbError = { code?: string | null; message?: string | null };

export function joinSaleErrorMessage(error: DbError): string {
  switch (error.code) {
    case "P0002":
      return "That invite code did not match an open sale. Check it with your organizer and try again.";
    case "42501":
      return "Sign in again, then join the sale.";
    case "23514":
      return "Name your table in 1 to 80 characters.";
    default:
      return "We could not join the sale just now. Try again in a minute.";
  }
}

/** For inserts, updates and deletes on items. */
export function itemWriteErrorMessage(error: DbError): string {
  switch (error.code) {
    case "42501":
      return "This item is in a buyer's cart or already paid for, so it cannot be changed now.";
    case "23514":
      return "Something in the form is not allowed. Check the name, price and description.";
    case "23503":
      return "We could not find your table. Reload the page and try again.";
    default:
      return "We could not save that just now. Your changes are still here. Try again.";
  }
}

/** What to say when POST /api/pricing fails. `code` is the JSON body's `error`, when there is one. */
export function pricingErrorMessage(status: number, code?: string): string {
  if (status === 401) return "Your session ended. Sign in again to price this item.";
  if (status === 413 || code === "image_too_large") return "That photo is too large. Take it again a little further away.";
  if (status === 415 || code === "unsupported_media_type" || code === "invalid_base64") {
    return "We could not read that photo. Take a new one.";
  }
  if (status === 422 || code === "pricing_refused") {
    return "We cannot price this item. It may be something that cannot be sold here.";
  }
  return "We could not price this photo just now. Try again, or fill in the details yourself.";
}

/** Whether the seller may fill the form in by hand after a pricing failure. */
export function pricingAllowsManualEntry(status: number): boolean {
  return status !== 422 && status !== 401;
}
