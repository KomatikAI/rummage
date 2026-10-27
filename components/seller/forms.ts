import { z } from "zod";

import { ITEM_CATEGORIES, ITEM_CONDITIONS, type ItemCategory, type ItemCondition } from "@/lib/supabase/types";

/** Form parsing for the seller pages. Messages are shown to the seller as written. */

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  kids: "Kids and toys",
  furniture: "Furniture",
  kitchen: "Kitchen",
  garden: "Garden",
  books: "Books",
  sports: "Sports",
  clothing: "Clothing",
  electronics: "Electronics",
  tools: "Tools",
  decor: "Decor",
  other: "Something else",
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "Well used",
};

/** numeric(10,2) allows more, but no yard-sale price needs it. */
export const MAX_PRICE = 100_000;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_LABEL_LENGTH = 80;

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

/** "12", "12.5", "$12.50" or "1,200" -> dollars. Null when it is not a usable price. */
export function parsePrice(raw: string): number | null {
  const clean = raw.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!PRICE_RE.test(clean)) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value > MAX_PRICE) return null;
  return Math.round(value * 100) / 100;
}

/** A price for an input field: 12 -> "12", 12.5 -> "12.50". */
export function priceToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const priceField = z
  .string()
  .trim()
  .min(1, "Add a price in dollars, like 5 or 12.50.")
  .transform((raw, ctx) => {
    const value = parsePrice(raw);
    if (value === null) {
      ctx.addIssue({ code: "custom", message: "Use dollars, like 5 or 12.50, up to $100,000." });
      return z.NEVER;
    }
    return value;
  });

const titleField = z
  .string()
  .trim()
  .min(1, "Give it a short name buyers will recognize.")
  .max(MAX_TITLE_LENGTH, `Keep the name under ${MAX_TITLE_LENGTH} characters.`);

const descriptionField = z
  .string()
  .trim()
  .max(MAX_DESCRIPTION_LENGTH, `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`)
  .transform((value) => (value.length === 0 ? null : value));

// ---------------------------------------------------------------------------
// Join a sale
// ---------------------------------------------------------------------------

/**
 * Takes what the seller pasted: the bare invite code, or a whole invite link. From a
 * link it uses an `invite`, `token` or `code` query value, or else the last path part.
 */
export function extractInviteToken(raw: string): string {
  const value = raw.trim();
  if (!value.includes("/") && !value.includes("?")) return value.replace(/\s+/g, "");
  try {
    const url = new URL(value, "https://invite.invalid");
    for (const key of ["invite", "token", "code"]) {
      const found = url.searchParams.get(key);
      if (found && found.trim()) return found.trim();
    }
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? "";
  } catch {
    return value.replace(/\s+/g, "");
  }
}

export const joinSaleSchema = z.object({
  inviteCode: z
    .string()
    .transform(extractInviteToken)
    .pipe(z.string().min(1, "Paste the invite code from your organizer.").max(200, "That invite code is too long. Check it and try again.")),
  label: z
    .string()
    .trim()
    .min(1, "Name your table, like “The Alvarez table”.")
    .max(MAX_LABEL_LENGTH, `Keep the table name under ${MAX_LABEL_LENGTH} characters.`),
});
export type JoinSaleInput = z.infer<typeof joinSaleSchema>;

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_PATH_RE = new RegExp(`^households/(${UUID})/(${UUID})\\.jpg$`, "i");

/** Storage path for a new item photo. The bucket only accepts writes under households/<id>/. */
export function photoPathFor(householdId: string, photoId: string): string {
  return `households/${householdId}/${photoId}.jpg`;
}

/** True when the path is a photo this app wrote for that household. */
export function isOwnPhotoPath(path: string, householdId: string): boolean {
  const match = PHOTO_PATH_RE.exec(path);
  return match !== null && match[1].toLowerCase() === householdId.toLowerCase();
}

// ---------------------------------------------------------------------------
// New item
// ---------------------------------------------------------------------------

const optionalDollars = z.number().min(0).max(MAX_PRICE).nullable().optional();

export const newItemSchema = z
  .object({
    householdId: z.uuid("Something went wrong with your table. Reload the page."),
    photoPath: z.string().min(1, "Add a photo first."),
    title: titleField,
    description: descriptionField,
    category: z.enum(ITEM_CATEGORIES, "Pick a category."),
    condition: z.enum(ITEM_CONDITIONS, "Pick a condition."),
    price: priceField,
    priceLow: optionalDollars,
    priceHigh: optionalDollars,
    priceReason: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (!isOwnPhotoPath(input.photoPath, input.householdId)) {
      ctx.addIssue({ code: "custom", path: ["photoPath"], message: "That photo did not upload to your table. Add it again." });
    }
  })
  .transform((input) => {
    // Keep the suggested range only when it is a real range (the database checks low <= high).
    const hasRange =
      typeof input.priceLow === "number" && typeof input.priceHigh === "number" && input.priceLow <= input.priceHigh;
    return {
      householdId: input.householdId,
      photoPath: input.photoPath,
      title: input.title,
      description: input.description,
      category: input.category,
      condition: input.condition,
      price: input.price,
      priceLow: hasRange ? (input.priceLow ?? null) : null,
      priceHigh: hasRange ? (input.priceHigh ?? null) : null,
      priceReason: input.priceReason ? input.priceReason : null,
    };
  });
export type NewItemInput = z.input<typeof newItemSchema>;
export type NewItem = z.output<typeof newItemSchema>;

// ---------------------------------------------------------------------------
// Edit item
// ---------------------------------------------------------------------------

export const editItemSchema = z.object({
  itemId: z.uuid("We could not find that item. Go back to your items and try again."),
  title: titleField,
  description: descriptionField,
  price: priceField,
});
export type EditItem = z.output<typeof editItemSchema>;

export const itemIdSchema = z.uuid();

// ---------------------------------------------------------------------------
// Pickup codes
// ---------------------------------------------------------------------------

/** Mirrors private.new_pickup_code(): six of A-Z and 2-9, never 0, O, 1 or I. */
export const PICKUP_CODE_LENGTH = 6;
export const PICKUP_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** Uppercases and drops spaces and dashes, as buyers often read codes out in pairs. */
export function normalizePickupCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export type PickupCodeCheck = { ok: true; code: string } | { ok: false; message: string };

export function checkPickupCode(raw: string): PickupCodeCheck {
  const code = normalizePickupCode(raw);
  if (code.length === 0) return { ok: false, message: "Type the code from the buyer's phone." };
  if (/[01OI]/.test(code)) {
    return { ok: false, message: "Pickup codes never use 0, O, 1 or I. Check the code with the buyer." };
  }
  if (code.length !== PICKUP_CODE_LENGTH || !PICKUP_CODE_RE.test(code)) {
    return { ok: false, message: `Pickup codes are ${PICKUP_CODE_LENGTH} letters and numbers. Check it with the buyer.` };
  }
  return { ok: true, code };
}

// ---------------------------------------------------------------------------
// Field errors
// ---------------------------------------------------------------------------

export type FieldErrors = Partial<Record<string, string>>;

/** The first message for each top-level field. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "form";
    if (out[key] === undefined) out[key] = issue.message;
  }
  return out;
}

/** Reads a string field from FormData; anything else becomes "". */
export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
