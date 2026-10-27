import { convertToModelMessages, safeValidateUIMessages } from "ai";
import { z } from "zod";

import { runShoppingAssistant } from "@/lib/ai/shopping-assistant";
import { createRepos, currentUserId, ensureLiveCart, RepoError } from "@/lib/repos";
import { jsonError, readJsonBody } from "@/lib/repos/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST { saleId, messages } -> the shopping assistant's AI SDK UI-message stream.
 *
 * `messages` are the `useChat` UI messages. The buyer must be signed in; the cart is the
 * buyer's live cart for the sale (created open when there is none), bound into the tools
 * so the model never chooses it. The assistant can search, hold, release and read the
 * cart; it never pays.
 */

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 100;

const bodySchema = z.object({
  saleId: z.uuid(),
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

export async function POST(request: Request): Promise<Response> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return jsonError(401, "sign_in_required");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request");
  const { saleId } = parsed.data;

  const validated = await safeValidateUIMessages({ messages: parsed.data.messages });
  if (!validated.success) return jsonError(400, "invalid_messages");

  try {
    const { data: sale, error: saleError } = await db
      .from("public_sales")
      .select("id, name, status")
      .eq("id", saleId)
      .maybeSingle();
    if (saleError) return jsonError(500, "sale_lookup_failed");
    if (!sale) return jsonError(404, "sale_not_found");
    if (sale.status !== "open") return jsonError(409, "sale_not_open");

    const cart = await ensureLiveCart(db, saleId, userId);
    if (cart.status === "checkout") {
      // hold_item / release_hold only work on an open cart; the buyer is mid-payment.
      return jsonError(409, "cart_in_checkout", { cartPath: "/buyer/cart" });
    }

    const messages = await convertToModelMessages(validated.data);
    const repos = await createRepos(saleId, db);
    const { result } = runShoppingAssistant({
      messages,
      repo: repos.items,
      cartId: cart.cartId,
      saleName: sale.name,
    });
    return result.toUIMessageStreamResponse();
  } catch (error) {
    if (error instanceof RepoError && error.code === "cart_not_allowed") {
      return jsonError(409, "sale_not_open");
    }
    console.error("assistant/shop failed", error instanceof Error ? error.message : error);
    return jsonError(500, "assistant_failed");
  }
}
