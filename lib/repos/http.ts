/**
 * Small request helpers shared by the assistant and pricing route handlers.
 */

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status });
}

/** The declared body size, or null when the header is missing or malformed. */
export function contentLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export type BodyBytes = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; reason: "too_large" | "unreadable" };

/**
 * Reads a body as bytes, stopping as soon as it passes `maxBytes`. The content-length
 * header is checked first, but a client can leave it off or lie, so the stream itself is
 * counted and cancelled at the limit instead of being buffered whole.
 */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<BodyBytes> {
  const declared = contentLength(request);
  if (declared !== null && declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(new ArrayBuffer(0)) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Reads a JSON body, refusing anything over `maxBytes` (by header and by actual length)
 * with 413 and anything unparseable with 400.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const body = await readBodyBytes(request, maxBytes);
  if (!body.ok) {
    return {
      ok: false,
      response:
        body.reason === "too_large"
          ? jsonError(413, "body_too_large", { maxBytes })
          : jsonError(400, "invalid_body"),
    };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json") };
  }
}
