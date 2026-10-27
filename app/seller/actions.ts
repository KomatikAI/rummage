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
import { currentUserId } from "@/lib/repos/auth";
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

export async function createItem(input: NewItemInput): Promise<CreateItemResult> {
  const parsed = newItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the fields marked below.", fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const db = await sellerDb();
  if (!db) return { ok: false, error: SIGNED_OUT };

  const item = parsed.data;
  const { data, error } = await db
    .from("items")
    .insert({
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
      status: "listed",
    })
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
