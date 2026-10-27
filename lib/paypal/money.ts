import { z } from "zod";

/** Up to 10 integer digits, exactly two decimals, no sign: "0.50", "125.00". */
export const MONEY_PATTERN = /^(0|[1-9]\d{0,9})\.\d{2}$/;

/** "12.34" -> 1234. Assumes MONEY_PATTERN already matched. */
export function toCents(value: string): number {
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}

/** 1234 -> "12.34". */
export function fromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** A positive two-decimal amount string. */
export const positiveMoneyString = z
  .string()
  .regex(MONEY_PATTERN, 'must be a 2-decimal string like "12.50"')
  .refine((value) => toCents(value) > 0, "must be greater than 0.00");

/** Flattens zod issues into "path: message" strings. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
