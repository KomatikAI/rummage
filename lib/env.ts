import { z } from "zod";

/**
 * Server-side environment, validated with zod on first access and cached.
 *
 * Rummage is sandbox only: loading the env throws unless PAYPAL_ENV is
 * exactly "sandbox", so a live PayPal key can never be used by mistake.
 */
const nonEmpty = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

export const serverEnvSchema = z.object({
  PAYPAL_ENV: z.literal("sandbox", {
    error: 'PAYPAL_ENV must be "sandbox". Rummage only runs against the PayPal sandbox.',
  }),
  PAYPAL_CLIENT_ID: nonEmpty("PAYPAL_CLIENT_ID"),
  PAYPAL_CLIENT_SECRET: nonEmpty("PAYPAL_CLIENT_SECRET"),
  PAYPAL_BN_CODE: nonEmpty("PAYPAL_BN_CODE"),
  PAYPAL_PARTNER_MERCHANT_ID: nonEmpty("PAYPAL_PARTNER_MERCHANT_ID"),
  PAYPAL_WEBHOOK_ID: nonEmpty("PAYPAL_WEBHOOK_ID"),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: nonEmpty("NEXT_PUBLIC_PAYPAL_CLIENT_ID"),
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
  ANTHROPIC_API_KEY: nonEmpty("ANTHROPIC_API_KEY"),
  APP_URL: z.url({ error: "APP_URL must be a URL" }),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Validates a raw env object. Throws one Error listing every problem. */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "env";
      return `  - ${key}: ${issue.message}`;
    });
    throw new Error(`Invalid server environment:\n${problems.join("\n")}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Lazily loads and caches the validated server env from process.env. */
export function getEnv(): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(process.env);
  }
  return cached;
}

/** Clears the cache. For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** Typed, lazily validated server env: `env.PAYPAL_CLIENT_ID`. */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop) {
    return getEnv()[prop as keyof ServerEnv];
  },
});
