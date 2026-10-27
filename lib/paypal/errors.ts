import type { PayPalErrorBody, PayPalErrorDetail } from "./types";

/**
 * A non-expected HTTP status from PayPal. `paypalName` is PayPal's error
 * `name` (e.g. "UNPROCESSABLE_ENTITY"); the class keeps `name` as
 * "PayPalApiError" so stack traces and `instanceof` stay ordinary.
 */
export class PayPalApiError extends Error {
  override readonly name = "PayPalApiError";
  readonly status: number;
  readonly paypalName: string;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(args: {
    status: number;
    paypalName: string;
    message: string;
    debugId?: string;
    details?: PayPalErrorDetail[];
    method: string;
    path: string;
    body?: unknown;
  }) {
    super(args.message);
    this.status = args.status;
    this.paypalName = args.paypalName;
    this.debugId = args.debugId;
    this.details = args.details ?? [];
    this.method = args.method;
    this.path = args.path;
    this.body = args.body;
  }

  /** The `issue` codes from `details`, e.g. ["INSTRUMENT_DECLINED"]. */
  get issues(): string[] {
    return this.details.map((detail) => detail.issue);
  }
}

/** Input rejected before any request was sent (zod validation). */
export class PayPalInputError extends Error {
  override readonly name = "PayPalInputError";
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(`${message}: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalises an error body. Handles the REST shape
 * `{ name, message, debug_id, details }` and the OAuth shape
 * `{ error, error_description }`.
 */
export function toPayPalErrorBody(status: number, body: unknown): PayPalErrorBody {
  if (isRecord(body)) {
    if (typeof body.name === "string") {
      const details = Array.isArray(body.details)
        ? body.details.filter(isRecord).map((detail) => ({
            issue: typeof detail.issue === "string" ? detail.issue : "UNKNOWN",
            description: typeof detail.description === "string" ? detail.description : undefined,
            field: typeof detail.field === "string" ? detail.field : undefined,
            value: typeof detail.value === "string" ? detail.value : undefined,
            location: typeof detail.location === "string" ? detail.location : undefined,
          }))
        : undefined;
      return {
        name: body.name,
        message: typeof body.message === "string" ? body.message : `PayPal returned HTTP ${status}`,
        debug_id: typeof body.debug_id === "string" ? body.debug_id : undefined,
        details,
      };
    }
    if (typeof body.error === "string") {
      return {
        name: body.error,
        message:
          typeof body.error_description === "string" ? body.error_description : `PayPal returned HTTP ${status}`,
      };
    }
  }
  return { name: `HTTP_${status}`, message: `PayPal returned HTTP ${status}` };
}

export function toPayPalApiError(args: {
  status: number;
  body: unknown;
  method: string;
  path: string;
  debugIdHeader?: string | null;
}): PayPalApiError {
  const parsed = toPayPalErrorBody(args.status, args.body);
  return new PayPalApiError({
    status: args.status,
    paypalName: parsed.name,
    message: parsed.message,
    debugId: parsed.debug_id ?? args.debugIdHeader ?? undefined,
    details: parsed.details,
    method: args.method,
    path: args.path,
    body: args.body,
  });
}
