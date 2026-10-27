import type { Tool } from "ai";
import { z } from "zod";

import { runOrganizerAssistant } from "@/lib/ai/organizer-tools";
import { createRepos, currentUserId, RepoError } from "@/lib/repos";
import { jsonError, readJsonBody } from "@/lib/repos/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST { saleId, messages } -> { text, toolCalls } from the read-only organizer assistant.
 *
 * `runOrganizerAssistant` answers one question and does not stream, so the latest user
 * message is the question (UI messages with text parts, or `{ role, content }`). Only the
 * sale's organizer (`sales.organizer_user_id`) may ask: 401 signed out, 403 otherwise.
 * PayPal sandbox read-only tools are attached only when PAYPAL_CLIENT_ID and
 * PAYPAL_CLIENT_SECRET are both set.
 */

const MAX_BODY_BYTES = 256 * 1024;
const MAX_QUESTION_CHARS = 2000;

const messageSchema = z.object({
  role: z.string(),
  content: z.string().optional(),
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
});

const bodySchema = z.object({
  saleId: z.uuid(),
  messages: z.array(messageSchema).min(1).max(100),
});

type BodyMessage = z.infer<typeof messageSchema>;

/** Text of the most recent user message, trimmed; "" when there is none. */
function latestQuestion(messages: BodyMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const fromParts = (message.parts ?? [])
      .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
      .join("\n");
    return (fromParts || message.content || "").trim();
  }
  return "";
}

async function paypalToolsFromEnv(): Promise<Record<string, Tool> | undefined> {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  try {
    // Loaded only when configured: the toolkit pulls in its own nested ai@4 and zod@3.
    const { makePayPalOrganizerTools } = await import("@/lib/ai/paypal-toolkit-adapter");
    return makePayPalOrganizerTools({ clientId, clientSecret });
  } catch (error) {
    console.error(
      "assistant/organizer: PayPal tools unavailable",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return jsonError(401, "sign_in_required");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request");
  const { saleId } = parsed.data;

  const question = latestQuestion(parsed.data.messages);
  if (!question) return jsonError(400, "question_required");
  if (question.length > MAX_QUESTION_CHARS) {
    return jsonError(400, "question_too_long", { maxChars: MAX_QUESTION_CHARS });
  }

  const { data: sale, error: saleError } = await db
    .from("sales")
    .select("id, organizer_user_id")
    .eq("id", saleId)
    .maybeSingle();
  if (saleError) return jsonError(500, "sale_lookup_failed");
  // RLS hides sales the caller neither organizes nor joined, so "missing" is also 403.
  if (!sale || sale.organizer_user_id !== userId) return jsonError(403, "organizer_only");

  try {
    const repos = await createRepos(saleId, db);
    const paypalTools = await paypalToolsFromEnv();
    const answer = await runOrganizerAssistant({
      question,
      repo: repos.sale,
      saleId,
      ...(paypalTools ? { paypalTools } : {}),
    });
    return Response.json({
      text: answer.text,
      toolCalls: answer.toolCalls.map((call) => ({ step: call.step, toolName: call.toolName })),
      paypalData: paypalTools !== undefined,
    });
  } catch (error) {
    if (error instanceof RepoError && error.code === "not_organizer") {
      return jsonError(403, "organizer_only");
    }
    console.error("assistant/organizer failed", error instanceof Error ? error.message : error);
    return jsonError(500, "assistant_failed");
  }
}
