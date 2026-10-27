import { z } from "zod";

import { priceFromPhoto, PricingError, type PricingMediaType } from "@/lib/ai/pricing";
import { currentUserId } from "@/lib/repos";
import { contentLength, jsonError, readJsonBody } from "@/lib/repos/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST a photo -> a `ListingDraft` (guidance; the seller sets the final price).
 *
 * Accepts either multipart/form-data (`image` file, optional `sellerHint`, `saleContext`)
 * or JSON `{ imageBase64, mediaType, sellerHint?, saleContext? }`. Signed-in users only.
 * The image is capped at 5 MB and is never stored: it goes to the model and is dropped.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Base64 is 4/3 of the bytes; leave room for the JSON envelope and hints. */
const MAX_JSON_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16 * 1024;
const MAX_MULTIPART_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

const PRICING_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const satisfies readonly PricingMediaType[];

const mediaTypeSchema = z.enum(PRICING_MEDIA_TYPES);
const hintSchema = z.string().trim().max(500).optional();

const jsonBodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType: mediaTypeSchema,
  sellerHint: hintSchema,
  saleContext: hintSchema,
});

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a (whitespace-free, valid) base64 string decodes to. */
function base64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

type PhotoInput = {
  imageBase64: string;
  mediaType: PricingMediaType;
  sellerHint?: string;
  saleContext?: string;
};

type Parsed = { ok: true; input: PhotoInput } | { ok: false; response: Response };

async function fromJson(request: Request): Promise<Parsed> {
  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (!body.ok) return body;
  const parsed = jsonBodySchema.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: jsonError(400, "invalid_request") };

  // Tolerate a data URL; its media type must agree with the declared one.
  let data = parsed.data.imageBase64.replace(/\s+/g, "");
  const dataUrl = /^data:([^;,]+);base64,/.exec(data);
  if (dataUrl) {
    if (dataUrl[1] !== parsed.data.mediaType) {
      return { ok: false, response: jsonError(400, "media_type_mismatch") };
    }
    data = data.slice(dataUrl[0].length);
  }
  if (!BASE64_RE.test(data) || data.length % 4 !== 0) {
    return { ok: false, response: jsonError(400, "invalid_base64") };
  }
  if (base64DecodedBytes(data) > MAX_IMAGE_BYTES) {
    return { ok: false, response: jsonError(413, "image_too_large", { maxBytes: MAX_IMAGE_BYTES }) };
  }
  return {
    ok: true,
    input: {
      imageBase64: data,
      mediaType: parsed.data.mediaType,
      ...(parsed.data.sellerHint ? { sellerHint: parsed.data.sellerHint } : {}),
      ...(parsed.data.saleContext ? { saleContext: parsed.data.saleContext } : {}),
    },
  };
}

async function fromMultipart(request: Request): Promise<Parsed> {
  const declared = contentLength(request);
  if (declared !== null && declared > MAX_MULTIPART_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "image_too_large", { maxBytes: MAX_IMAGE_BYTES }) };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_form") };
  }
  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return { ok: false, response: jsonError(400, "image_required") };
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return { ok: false, response: jsonError(413, "image_too_large", { maxBytes: MAX_IMAGE_BYTES }) };
  }
  const mediaType = mediaTypeSchema.safeParse(image.type);
  if (!mediaType.success) return { ok: false, response: jsonError(415, "unsupported_media_type") };

  const hints = z
    .object({ sellerHint: hintSchema, saleContext: hintSchema })
    .safeParse({
      sellerHint: form.get("sellerHint") ?? undefined,
      saleContext: form.get("saleContext") ?? undefined,
    });
  if (!hints.success) return { ok: false, response: jsonError(400, "invalid_request") };

  const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  return {
    ok: true,
    input: {
      imageBase64,
      mediaType: mediaType.data,
      ...(hints.data.sellerHint ? { sellerHint: hints.data.sellerHint } : {}),
      ...(hints.data.saleContext ? { saleContext: hints.data.saleContext } : {}),
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return jsonError(401, "sign_in_required");

  const contentType = request.headers.get("content-type") ?? "";
  const parsed = contentType.toLowerCase().startsWith("multipart/form-data")
    ? await fromMultipart(request)
    : await fromJson(request);
  if (!parsed.ok) return parsed.response;

  try {
    const draft = await priceFromPhoto(parsed.input);
    return Response.json(draft);
  } catch (error) {
    if (error instanceof PricingError) {
      return error.code === "refusal"
        ? jsonError(422, "pricing_refused")
        : jsonError(502, "pricing_failed", { code: error.code });
    }
    console.error("pricing failed", error instanceof Error ? error.message : error);
    return jsonError(500, "pricing_failed");
  }
}
