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

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Reads a JSON body, refusing anything over `maxBytes` (by header and by actual length)
 * with 413 and anything unparseable with 400.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const declared = contentLength(request);
  if (declared !== null && declared > maxBytes) {
    return { ok: false, response: jsonError(413, "body_too_large", { maxBytes }) };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_body") };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, response: jsonError(413, "body_too_large", { maxBytes }) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json") };
  }
}
