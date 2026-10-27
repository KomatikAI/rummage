import type { BadgeTone } from "@/components/ui";
import type { ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";
import type { PayPalLinkStatus, SaleStatus } from "@/lib/supabase/types";

/**
 * Formatting for the organizer dashboard. Everything here is pure: the pages fetch
 * the sale row and organizer_sale_summary(), and these helpers shape what is shown.
 */

// ---------------------------------------------------------------- sale status

export interface StatusLook {
  tone: BadgeTone;
  label: string;
}

const SALE_STATUS_LOOKS: Record<SaleStatus, StatusLook> = {
  draft: { tone: "outline", label: "Draft" },
  open: { tone: "accent", label: "Open" },
  closed: { tone: "neutral", label: "Closed" },
};

export function saleStatusLook(status: SaleStatus): StatusLook {
  return SALE_STATUS_LOOKS[status];
}

export interface StatusAction {
  to: Extract<SaleStatus, "open" | "closed">;
  label: string;
  variant: "primary" | "secondary";
}

/** The status buttons for a sale: open a draft or closed sale, close an open one. */
export function statusActions(status: SaleStatus): StatusAction[] {
  switch (status) {
    case "draft":
      return [{ to: "open", label: "Open sale", variant: "primary" }];
    case "open":
      return [{ to: "closed", label: "Close sale", variant: "secondary" }];
    case "closed":
      return [{ to: "open", label: "Open sale", variant: "secondary" }];
  }
}

/** One line under the header saying what the status means for buyers and sellers. */
export function saleStatusHint(status: SaleStatus): string {
  switch (status) {
    case "draft":
      return "Households can join and list items. Buyers cannot see the sale until you open it.";
    case "open":
      return "Buyers can browse, hold items and pay.";
    case "closed":
      return "Buyers can still see the sale, but nothing new can be held or paid for.";
  }
}

// ---------------------------------------------------------------- dates

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "08:00" or "14:30:00" -> "8:00 AM" / "2:30 PM". Unparseable times are returned as given. */
export function formatTimeOfDay(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  if (hours > 23) return time;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

/** "Saturday, November 14, 2026 · 8:00 AM to 2:00 PM", or "Date not set". */
export function formatSaleWhen(saleDate: string | null, startsAt: string | null, endsAt: string | null): string {
  if (!saleDate) return "Date not set";
  const date = new Date(`${saleDate}T00:00:00Z`);
  const day = Number.isNaN(date.getTime()) ? saleDate : DAY_FORMAT.format(date);
  if (startsAt && endsAt) return `${day} · ${formatTimeOfDay(startsAt)} to ${formatTimeOfDay(endsAt)}`;
  if (startsAt) return `${day} · from ${formatTimeOfDay(startsAt)}`;
  return day;
}

// ---------------------------------------------------------------- summary strip

export interface SummaryStat {
  key: "available" | "held" | "sold" | "collected" | "gross";
  label: string;
  value: number;
  /** Render with Money instead of as a count. */
  money: boolean;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The strip across the dashboard, with the same maths as SupabaseSaleReadRepo.saleSummary:
 * sold counts cash sales too, and gross sales are completed, unrefunded PayPal captures
 * plus the cash sales sellers recorded.
 */
export function summaryStats(summary: ParsedOrganizerSummary): SummaryStat[] {
  return [
    { key: "available", label: "Available", value: summary.items_listed, money: false },
    { key: "held", label: "Held", value: summary.items_held, money: false },
    { key: "sold", label: "Sold", value: summary.items_sold + summary.items_cash_sold, money: false },
    { key: "collected", label: "Collected", value: summary.items_collected, money: false },
    { key: "gross", label: "Gross sales", value: roundCents(summary.gross_total + summary.cash_total), money: true },
  ];
}

// ---------------------------------------------------------------- households

export type HouseholdLinkState = "unlinked" | "pending" | "ready";

/** households.paypal_status as the three states the table shows; a revoked link reads as unlinked. */
export function householdLinkState(status: PayPalLinkStatus): HouseholdLinkState {
  if (status === "ready") return "ready";
  if (status === "pending") return "pending";
  return "unlinked";
}

const LINK_LOOKS: Record<HouseholdLinkState, StatusLook> = {
  unlinked: { tone: "neutral", label: "Not linked" },
  pending: { tone: "outline", label: "Pending" },
  ready: { tone: "ready", label: "Ready" },
};

export function linkStateLook(state: HouseholdLinkState): StatusLook {
  return LINK_LOOKS[state];
}

export interface HouseholdRowView {
  id: string;
  label: string;
  linkState: HouseholdLinkState;
  paused: boolean;
  /** Every item the household put up for sale: available, held and sold. */
  itemsListed: number;
  /** Sold through checkout or for cash. */
  itemsSold: number;
}

export function householdRows(summary: ParsedOrganizerSummary): HouseholdRowView[] {
  return summary.per_household.map((household) => {
    const itemsSold = household.items_sold + household.items_cash_sold;
    return {
      id: household.household_id,
      label: household.label,
      linkState: householdLinkState(household.paypal_status),
      paused: household.paused,
      itemsListed: household.items_listed + household.items_held + itemsSold,
      itemsSold,
    };
  });
}

/** "4 of 6 households can be paid", or a nudge when nobody has joined. */
export function householdsReadyLine(summary: Pick<ParsedOrganizerSummary, "households" | "households_linked">): string {
  if (summary.households === 0) return "No households yet. Share the invite link to get started.";
  const noun = summary.households === 1 ? "household" : "households";
  return `${summary.households_linked} of ${summary.households} ${noun} can be paid at checkout.`;
}

// ---------------------------------------------------------------- invites

/** APP_URL without a trailing slash. */
export function baseUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/** The link households open to join: <app>/seller?invite=<token>. */
export function inviteLink(appUrl: string, inviteToken: string): string {
  return `${baseUrl(appUrl)}/seller?invite=${encodeURIComponent(inviteToken)}`;
}

/** A short note the organizer can paste into a message to one household. */
export function inviteReminder(input: {
  label: string;
  saleName: string;
  link: string;
  linkState: HouseholdLinkState;
}): string {
  const { label, saleName, link, linkState } = input;
  switch (linkState) {
    case "unlinked":
      return `Hi ${label}, a quick reminder for ${saleName}: link your PayPal on your seller page so buyers can pay you. ${link}`;
    case "pending":
      return `Hi ${label}, PayPal is still checking your account for ${saleName}. Open your seller page to finish up. ${link}`;
    case "ready":
      return `Hi ${label}, you are all set for ${saleName}. Add or price your last items here. ${link}`;
  }
}

// ---------------------------------------------------------------- fundraiser

/** "Link the PTA's PayPal" for a PTA, otherwise "Link the fundraiser's PayPal". */
export function linkPayPalLabel(fundraiserName: string): string {
  return /\bPTA\b/.test(fundraiserName) ? "Link the PTA's PayPal" : "Link the fundraiser's PayPal";
}

export type OnboardingParam = "ready" | "pending";

/** Reads ?onboarding= after the PayPal return; anything else is ignored. */
export function readOnboardingParam(value: string | string[] | undefined): OnboardingParam | null {
  const single = Array.isArray(value) ? value[0] : value;
  return single === "ready" || single === "pending" ? single : null;
}

/** The one-line notice shown after the organizer comes back from PayPal. */
export function onboardingNotice(param: OnboardingParam, fundraiserName: string | null): string {
  const who = fundraiserName ?? "the fundraiser";
  return param === "ready"
    ? `PayPal is linked for ${who}. Buyers can now add a donation at checkout.`
    : `PayPal is still checking the account for ${who}. Donations start once it is confirmed; try linking again later.`;
}

/** "3 paid orders" / "1 paid order" / "No paid orders yet". */
export function paidOrdersLine(count: number): string {
  if (count === 0) return "No paid orders yet";
  return `${count} paid ${count === 1 ? "order" : "orders"}`;
}
