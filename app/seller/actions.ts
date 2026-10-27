"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  CreateItemResult,
  EditItemState,
  ItemStatusState,
  JoinSaleState,
  PickupState,
} from "@/components/seller/action-state";
import {
  checkPickupCode,
  editItemSchema,
  fieldErrorsOf,
  formString,
  itemIdSchema,
  joinSaleSchema,
  newItemSchema,
  type NewItemInput,
} from "@/components/seller/forms";
import { householdQuery, itemWriteErrorMessage, joinSaleErrorMessage } from "@/components/seller/seller-copy";
import type { PricingMediaType } from "@/lib/ai/pricing";
import {
  detectImageMediaType,
  screenListing,
  SCREEN_DEFAULT_REASON,
  SCREEN_MAX_IMAGE_BYTES,
} from "@/lib/ai/screen-listing";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ItemStatus } from "@/lib/supabase/types";

import { ITEM_PHOTO_BUCKET } from "./data";

/**
 * Seller server actions. Each one re-checks the session; row ownership is enforced by
 * RLS (items_* policies) and the items guard trigger, so a forged id only ever fails.
 */

const EDITABLE: ItemStatus[] = ["listed", "draft", "hidden"];
const SIGNED_OUT = "Your session ended. Sign in again and try once more.";

async function sellerDb() {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  return userId ? db : null;
}

function revalidateSeller() {
  revalidatePath("/seller", "layout");
}

// ---------------------------------------------------------------------------
// Join a sale
// ---------------------------------------------------------------------------

export async function joinSale(_previous: JoinSaleState, formData: FormData): Promise<JoinSaleState> {
  const values = { inviteCode: formString(formData, "inviteCode"), label: formString(formData, "label") };
  const parsed = joinSaleSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: fieldErrorsOf(parsed.error) };

  const db = await sellerDb();
  if (!db) return { values, error: SIGNED_OUT };

  const { data, error } = await db.rpc("join_sale", {
    p_invite_token: parsed.data.inviteCode,
    p_label: parsed.data.label,
  });
  if (error || !data) return { values, error: joinSaleErrorMessage(error ?? {}) };

  revalidateSeller();
  redirect(`/seller${householdQuery(data)}`);
}

// ---------------------------------------------------------------------------
// New item (the photo is already uploaded by the browser)
// ---------------------------------------------------------------------------

type ScreenPhoto =
  | { ok: true; imageBase64: string; mediaType: PricingMediaType }
  | { ok: false; error: string };

const PHOTO_UNREADABLE = "We could not read that photo to check it. Add the photo again and list it once more.";

/** Reads the uploaded photo back from storage (service role) for the prohibited-item screen. */
async function readPhotoForScreen(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  photoPath: string,
): Promise<ScreenPhoto> {
  const { data, error } = await admin.storage.from(ITEM_PHOTO_BUCKET).download(photoPath);
  if (error || !data) return { ok: false, error: PHOTO_UNREADABLE };
  if (data.size > SCREEN_MAX_IMAGE_BYTES) {
    return { ok: false, error: "That photo is too large to check. Take it again and list it once more." };
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mediaType = detectImageMediaType(bytes);
  if (!mediaType) return { ok: false, error: PHOTO_UNREADABLE };
  return { ok: true, imageBase64: Buffer.from(bytes).toString("base64"), mediaType };
}

/**
 * Lists a new item. Every listing is screened for prohibited items here, on the server,
 * whether or not the seller used "Price it" (the browser block stays as the first line).
 * Sellers cannot write prohibited_flag, so a flagged item is stored with the service role
 * as a draft carrying the flag and reason (the database refuses to list a flagged item),
 * and the seller gets a plain error. A screen that could not run lists nothing.
 */
export async function createItem(input: NewItemInput): Promise<CreateItemResult> {
  const parsed = newItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the fields marked below.", fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { ok: false, error: SIGNED_OUT };

  const item = parsed.data;

  // The service-role writes below bypass RLS, so confirm the seller owns the table first.
  const household = await db
    .from("households")
    .select("id")
    .eq("id", item.householdId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (household.error) return { ok: false, error: "We could not check your table just now. Try again." };
  if (!household.data) return { ok: false, error: "We could not find your table. Reload the page and try again." };

  const admin = createSupabaseAdminClient();
  const photo = await readPhotoForScreen(admin, item.photoPath);
  if (!photo.ok) return { ok: false, error: photo.error };

  const screen = await screenListing({
    title: item.title,
    description: item.description,
    category: item.category,
    imageBase64: photo.imageBase64,
    mediaType: photo.mediaType,
  });
  if (!screen.checked) {
    return { ok: false, error: "We could not check this item just now. Try again; your details are still here." };
  }

  const row = {
    household_id: item.householdId,
    title: item.title,
    description: item.description,
    category: item.category,
    condition: item.condition,
    price: item.price,
    price_low: item.priceLow,
    price_high: item.priceHigh,
    price_reason: item.priceReason,
    photo_path: item.photoPath,
  };

  if (screen.prohibited) {
    const reason = screen.reason ?? SCREEN_DEFAULT_REASON;
    const flagged = await admin
      .from("items")
      .insert({ ...row, status: "draft", prohibited_flag: true, prohibited_reason: reason })
      .select("id")
      .single();
    const refused = `This item cannot be listed at this sale. ${reason}`;
    if (flagged.error) return { ok: false, error: refused };
    revalidateSeller();
    return { ok: false, error: `${refused} We kept it as a draft that buyers cannot see.` };
  }

  const { data, error } = await db
    .from("items")
    .insert({ ...row, status: "listed" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: itemWriteErrorMessage(error ?? {}) };

  revalidateSeller();
  return { ok: true, itemId: data.id };
}

// ---------------------------------------------------------------------------
// Edit, cash sale, relist, delete
// ---------------------------------------------------------------------------

/** Explains why a guarded write touched no row, from the item's current status. */
async function noRowMessage(db: NonNullable<Awaited<ReturnType<typeof sellerDb>>>, itemId: string): Promise<string> {
  const { data } = await db.from("items").select("status").eq("id", itemId).maybeSingle();
  if (!data) return "We could not find that item. It may have been deleted.";
  return EDITABLE.includes(data.status)
    ? "We could not save that just now. Try again."
    : "This item is in a buyer's cart or already sold, so it cannot be changed now.";
}

export async function updateItem(_previous: EditItemState, formData: FormData): Promise<EditItemState> {
  const values = {
    title: formString(formData, "title"),
    description: formString(formData, "description"),
    price: formString(formData, "price"),
  };
  const parsed = editItemSchema.safeParse({ itemId: formString(formData, "itemId"), ...values });
  if (!parsed.success) return { values, fieldErrors: fieldErrorsOf(parsed.error) };

  const db = await sellerDb();
  if (!db) return { values, error: SIGNED_OUT };

  const { itemId, title, description, price } = parsed.data;
  const { data, error } = await db
    .from("items")
    .update({ title, description, price })
    .eq("id", itemId)
    .in("status", EDITABLE)
    .select("id");
  if (error) return { values, error: itemWriteErrorMessage(error) };
  if (!data || data.length === 0) return { values, error: await noRowMessage(db, itemId) };

  revalidateSeller();
  return { saved: true, values };
}

async function setItemStatus(
  formData: FormData,
  from: ItemStatus[],
  to: Extract<ItemStatus, "cash_sold" | "listed">,
): Promise<ItemStatusState> {
  const itemId = itemIdSchema.safeParse(formString(formData, "itemId"));
  if (!itemId.success) return { error: "We could not find that item. Go back to your items and try again." };

  const db = await sellerDb();
  if (!db) return { error: SIGNED_OUT };

  const { data, error } = await db
    .from("items")
    .update({ status: to })
    .eq("id", itemId.data)
    .in("status", from)
    .select("id");
  if (error) return { error: itemWriteErrorMessage(error) };
  if (!data || data.length === 0) return { error: await noRowMessage(db, itemId.data) };

  revalidateSeller();
  return {};
}

export async function markCashSold(_previous: ItemStatusState, formData: FormData): Promise<ItemStatusState> {
  return setItemStatus(formData, EDITABLE, "cash_sold");
}

export async function relistItem(_previous: ItemStatusState, formData: FormData): Promise<ItemStatusState> {
  return setItemStatus(formData, ["cash_sold"], "listed");
}

export async function deleteItem(_previous: ItemStatusState, formData: FormData): Promise<ItemStatusState> {
  const itemId = itemIdSchema.safeParse(formString(formData, "itemId"));
  if (!itemId.success) return { error: "We could not find that item. Go back to your items and try again." };

  const db = await sellerDb();
  if (!db) return { error: SIGNED_OUT };

  const { data, error } = await db
    .from("items")
    .delete()
    .eq("id", itemId.data)
    .in("status", EDITABLE)
    .select("household_id, photo_path");
  if (error) return { error: itemWriteErrorMessage(error) };
  const deleted = data?.[0];
  if (!deleted) return { error: await noRowMessage(db, itemId.data) };

  // Best effort: an orphaned photo is harmless, so a failure here does not undo the delete.
  if (deleted.photo_path?.startsWith(`households/${deleted.household_id}/`)) {
    await db.storage.from(ITEM_PHOTO_BUCKET).remove([deleted.photo_path]);
  }

  revalidateSeller();
  redirect(`/seller${householdQuery(deleted.household_id)}`);
}

// ---------------------------------------------------------------------------
// Pickup
// ---------------------------------------------------------------------------

/**
 * Checks a buyer's pickup code against every paid item of the household. One code
 * covers everything that buyer paid this household for in one checkout, so each
 * matching item is marked collected.
 */
export async function confirmPickup(previous: PickupState, formData: FormData): Promise<PickupState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const householdId = itemIdSchema.safeParse(formString(formData, "householdId"));
  if (!householdId.success) return { attempt, error: "We could not find your table. Reload the page and try again." };

  const code = checkPickupCode(formString(formData, "code"));
  if (!code.ok) return { attempt, error: code.message };

  const db = await sellerDb();
  if (!db) return { attempt, error: SIGNED_OUT };

  const { data: sold, error } = await db
    .from("items")
    .select("id, title")
    .eq("household_id", householdId.data)
    .eq("status", "sold");
  if (error) return { attempt, error: "We could not load your paid items. Try again." };
  if (!sold || sold.length === 0) {
    return { attempt, error: "Nothing of yours is waiting for pickup right now." };
  }

  const collected: string[] = [];
  for (const item of sold) {
    const result = await db.rpc("mark_item_collected", { p_item: item.id, p_code: code.code });
    if (!result.error && result.data === true) collected.push(item.title);
  }
  if (collected.length === 0) {
    return { attempt, error: "That code does not match anything waiting for pickup. Check it with the buyer and try again." };
  }

  revalidateSeller();
  return { attempt, collected };
}
