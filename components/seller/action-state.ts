import type { FieldErrors } from "./forms";

/** State shapes the seller server actions return (kept out of the "use server" file). */

export type JoinSaleState = {
  error?: string;
  fieldErrors?: FieldErrors;
  values?: { inviteCode: string; label: string };
};

export type CreateItemResult =
  | { ok: true; itemId: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export type EditItemState = {
  error?: string;
  fieldErrors?: FieldErrors;
  saved?: boolean;
  values?: { title: string; description: string; price: string };
};

export type ItemStatusState = { error?: string };

export type PickupState = {
  error?: string;
  /** Titles of the items just marked collected. */
  collected?: string[];
  /** Bumped on every result so the screen can tell two results apart. */
  attempt?: number;
};
