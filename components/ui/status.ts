/** The statuses a Badge can show. docs/DESIGN.md maps each one to a colour. */
export const BADGE_STATUSES = ["available", "held", "sold", "collected", "ready", "pending"] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];

export type BadgeTone = "accent" | "held" | "neutral" | "ready-soft" | "ready" | "outline";

const TONES: Record<BadgeStatus, BadgeTone> = {
  available: "accent",
  held: "held",
  sold: "neutral",
  collected: "ready-soft",
  ready: "ready",
  pending: "outline",
};

const LABELS: Record<BadgeStatus, string> = {
  available: "Available",
  held: "Held",
  sold: "Sold",
  collected: "Collected",
  ready: "Ready",
  pending: "Pending",
};

export function statusTone(status: BadgeStatus): BadgeTone {
  return TONES[status];
}

export function statusLabel(status: BadgeStatus): string {
  return LABELS[status];
}

/** `items.status` values from the database. */
export type ItemStatus = "draft" | "listed" | "held" | "sold" | "collected" | "cash_sold" | "hidden";

/** Maps an `items.status` to the badge a buyer or seller sees. */
export function itemStatusBadge(status: ItemStatus): BadgeStatus {
  switch (status) {
    case "listed":
      return "available";
    case "held":
      return "held";
    case "sold":
    case "cash_sold":
      return "sold";
    case "collected":
      return "collected";
    case "draft":
    case "hidden":
      return "pending";
  }
}

/** `households.paypal_status` values: ready means the household can be paid. */
export type PayPalStatus = "unlinked" | "pending" | "ready" | "revoked";

export function paypalStatusBadge(status: PayPalStatus): BadgeStatus {
  return status === "ready" ? "ready" : "pending";
}
