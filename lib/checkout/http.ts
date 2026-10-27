import type { z } from "zod";

import { PayPalApiError, PayPalInputError } from "@/lib/paypal";

/**
 * Small HTTP helpers shared by the app/api/paypal route handlers. Every error
 * response has the shape `{ error: <snake_case_code>, message, ...extra }`.
 */

export function jsonError(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error, message, ...extra }, { status });
}

export const unauthorized = (): Response => jsonError(401, "unauthorized", "Sign in first.");

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Reads a JSON body and validates it with `schema`. Never throws. */
export async function readJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<BodyResult<z.output<Schema>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "The request body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    return {
      ok: false,
      response: jsonError(400, "invalid_body", "The request body is not valid.", { issues }),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Maps a thrown PayPal library error to a response, or returns null when the
 * error is something else. PayPal failures are 502 with PayPal's debug id (safe to
 * show; PayPal support asks for it). Request bodies and tokens are never echoed.
 */
export function paypalErrorResponse(error: unknown, route: string): Response | null {
  if (error instanceof PayPalApiError) {
    console.error(`[paypal/${route}] PayPal returned ${error.status}`, {
      paypalName: error.paypalName,
      debugId: error.debugId,
    });
    return jsonError(502, "paypal_error", "PayPal could not complete the request.", {
      debugId: error.debugId ?? null,
      paypalName: error.paypalName,
      issues: error.issues,
    });
  }
  if (error instanceof PayPalInputError) {
    return jsonError(409, "paypal_input_rejected", "The request could not be sent to PayPal.", {
      issues: error.issues,
    });
  }
  return null;
}

/** A database error: logged by code only, answered with a generic 500. */
export function databaseError(operation: string, error: { code?: string } | null | undefined): Response {
  console.error(`[paypal] ${operation} failed`, { code: error?.code ?? "unknown" });
  return jsonError(500, "database_error", "The change could not be saved. Try again.");
}

/** APP_URL without a trailing slash. */
export function appBaseUrl(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}
