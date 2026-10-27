"use server";

import { redirect } from "next/navigation";

import { parseSaleForm, readSaleForm, toSaleInsert, type SaleFormState } from "@/components/organizer/sale-form";
import { slugify, slugWithSuffix } from "@/components/organizer/slug";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UNIQUE_VIOLATION = "23505";
const SLUG_ATTEMPTS = 3;

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

/**
 * Creates a draft sale for the signed-in organizer. The row goes in through the cookie
 * client, so RLS (organizer_user_id = auth.uid()) and the column grants apply; status
 * and invite_token keep their defaults. A taken slug is retried with a short suffix.
 */
export async function createSale(_previous: SaleFormState, formData: FormData): Promise<SaleFormState> {
  const values = readSaleForm(formData);
  const parsed = parseSaleForm(values);
  if (!parsed.ok) return { values, fieldErrors: parsed.fieldErrors };

  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { values, formError: "Your session ended. Sign in again and try once more." };

  const base = slugify(parsed.data.name);
  let saleId: string | null = null;
  for (let attempt = 0; attempt < SLUG_ATTEMPTS && saleId === null; attempt += 1) {
    const slug = attempt === 0 ? base : slugWithSuffix(base, randomSuffix());
    const { data, error } = await db.from("sales").insert(toSaleInsert(parsed.data, userId, slug)).select("id").single();
    if (!error) {
      saleId = data.id;
    } else if (error.code !== UNIQUE_VIOLATION) {
      console.error("organizer: create sale failed", error.code);
      return { values, formError: "The sale could not be saved just now. Try again in a moment." };
    }
  }
  if (saleId === null) {
    return { values, formError: "That name is taken by other sales. Add a word or two and try again." };
  }
  redirect(`/organizer/${saleId}`);
}
