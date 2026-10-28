import { z } from "zod";

import { CONDITION_LABELS, toSaleItem, type SaleItem } from "@/components/buyer/listings";
import type { ScanResponse, ScanTable } from "@/components/buyer/scan/scan-types";
import {
  matchFrameToListings,
  ScanMatchError,
  SCAN_MAX_CANDIDATES,
  type ScanCandidate,
  type ScanMediaType,
} from "@/lib/ai/scan-match";
import { env } from "@/lib/env";
import { currentUserId } from "@/lib/repos";
import { jsonError, readJsonBody } from "@/lib/repos/http";
import { getPublicListings } from "@/lib/supabase/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { scanRateLimiter } from "./rate-limit";

/**
 * POST one camera frame from a buyer at a table -> which listed item it shows.
 *
 * JSON `{ saleSlug, householdId?, frameBase64, mediaType }`. Signed-in users only. The
 * server loads the candidates itself (listed and held items; sold ones are skipped), from
 * one table when `householdId` is given, else the whole sale when it has at most
 * `SCAN_MAX_CANDIDATES` scannable items (otherwise 400 `pick_a_table` with the tables).
 *
 * The frame is capped at 1.5 MB, goes to the model and is dropped: it is never logged or
 * stored. Calls are rate limited per user, per server instance (see ./rate-limit.ts).
 */

const MAX_FRAME_BYTES = 1.5 * 1024 * 1024;
/** Base64 is 4/3 of the bytes; leave room for the JSON envelope. */
const MAX_JSON_BODY_BYTES = Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 4 * 1024;

const SCAN_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const satisfies readonly ScanMediaType[];

const bodySchema = z.object({
  saleSlug: z.string().trim().min(1).max(200),
  householdId: z.string().trim().min(1).max(64).optional(),
  frameBase64: z.string().min(1),
  mediaType: z.enum(SCAN_MEDIA_TYPES),
});

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a (whitespace-free, valid) base64 string decodes to. */
function base64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function tablesOf(items: readonly SaleItem[]): ScanTable[] {
  const tables = new Map<string, ScanTable>();
  for (const item of items) {
    const table = tables.get(item.householdId) ?? { householdId: item.householdId, label: item.householdLabel, count: 0 };
    table.count += 1;
    tables.set(item.householdId, table);
  }
  return [...tables.values()];
}

function toCandidate(item: SaleItem): ScanCandidate {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    condition: CONDITION_LABELS[item.condition],
    price: item.price,
    photoUrl: item.photoUrl,
    status: item.status === "held" ? "held" : "available",
  };
}

export async function POST(request: Request): Promise<Response> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return jsonError(401, "sign_in_required");

  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request");

  // Tolerate a data URL; its media type must agree with the declared one.
  let frame = parsed.data.frameBase64.replace(/\s+/g, "");
  const dataUrl = /^data:([^;,]+);base64,/.exec(frame);
  if (dataUrl) {
    if (dataUrl[1] !== parsed.data.mediaType) return jsonError(400, "media_type_mismatch");
    frame = frame.slice(dataUrl[0].length);
  }
  if (!BASE64_RE.test(frame) || frame.length % 4 !== 0) return jsonError(400, "invalid_base64");
  if (base64DecodedBytes(frame) > MAX_FRAME_BYTES) {
    return jsonError(413, "image_too_large", { maxBytes: MAX_FRAME_BYTES });
  }

  const verdict = scanRateLimiter.check(userId);
  if (!verdict.ok) {
    return jsonError(429, "slow_down", { retryAfterMs: verdict.retryAfterMs });
  }

  const { saleSlug, householdId } = parsed.data;
  const [saleResult, rows] = await Promise.all([
    db.from("public_sales").select("id").eq("slug", saleSlug).maybeSingle(),
    getPublicListings(saleSlug, db).catch(() => null),
  ]);
  if (saleResult.error || rows === null) return jsonError(502, "listings_failed");
  if (!saleResult.data) return jsonError(404, "sale_not_found");

  const scannable = rows
    .map((row) => toSaleItem(row, env.NEXT_PUBLIC_SUPABASE_URL))
    .filter((item) => item.status !== "sold");

  let pool: SaleItem[];
  if (householdId) {
    if (!rows.some((row) => row.household_id === householdId)) return jsonError(404, "table_not_found");
    pool = scannable.filter((item) => item.householdId === householdId);
  } else {
    if (scannable.length > SCAN_MAX_CANDIDATES) {
      return jsonError(400, "pick_a_table", { households: tablesOf(scannable) });
    }
    pool = scannable;
  }
  // One very full table: compare the first SCAN_MAX_CANDIDATES, still-for-sale items first.
  const candidates = [...pool]
    .sort((a, b) => Number(a.status === "held") - Number(b.status === "held"))
    .slice(0, SCAN_MAX_CANDIDATES);
  const byId = new Map(candidates.map((item) => [item.id, item]));

  try {
    const result = await matchFrameToListings({
      frameBase64: frame,
      mediaType: parsed.data.mediaType,
      candidates: candidates.map(toCandidate),
    });
    const matched = result.match ? byId.get(result.match.itemId) : undefined;
    const response: ScanResponse = {
      match: result.match && matched ? { item: matched, confidence: result.match.confidence, box: result.match.box } : null,
      alternatives: result.alternatives.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      }),
      notListed: result.notListed,
    };
    return Response.json(response);
  } catch (error) {
    if (error instanceof ScanMatchError) {
      return error.code === "refusal"
        ? jsonError(422, "scan_refused")
        : jsonError(502, "scan_failed", { code: error.code });
    }
    // The message only; the request (and its frame) is never logged.
    console.error("scan failed", error instanceof Error ? error.message : "unknown error");
    return jsonError(500, "scan_failed");
  }
}
