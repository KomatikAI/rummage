import { z } from "zod";

/**
 * Server-side environment, validated with zod on first access and cached.
 *
 * Validation runs per group, not all at once: a public sale page that only needs the
 * Supabase URL renders without an Anthropic key, while any PayPal value is checked
 * together with PAYPAL_ENV. Rummage is sandbox only: reading a PayPal value throws unless
 * PAYPAL_ENV is exactly "sandbox", so a live PayPal key can never be used by mistake.
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
type EnvKey = keyof ServerEnv;

/**
 * Values validated together. Reading one key loads its whole group, so PAYPAL_ENV is
 * always checked before any PayPal credential is handed out.
 */
export const ENV_GROUPS = {
  paypal: [
    "PAYPAL_ENV",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_BN_CODE",
    "PAYPAL_PARTNER_MERCHANT_ID",
    "PAYPAL_WEBHOOK_ID",
    "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
  ],
  supabase: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  supabaseAdmin: ["SUPABASE_SERVICE_ROLE_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  app: ["APP_URL"],
} as const satisfies Record<string, readonly EnvKey[]>;

export type EnvGroup = keyof typeof ENV_GROUPS;

const groupOf = new Map<EnvKey, EnvGroup>();
for (const [group, keys] of Object.entries(ENV_GROUPS) as [EnvGroup, readonly EnvKey[]][]) {
  for (const key of keys) groupOf.set(key, group);
}

function invalid(scope: string, issues: z.core.$ZodIssue[]): Error {
  const problems = issues.map((issue) => {
    const key = issue.path.join(".") || "env";
    return `  - ${key}: ${issue.message}`;
  });
  return new Error(`Invalid ${scope}:\n${problems.join("\n")}`);
}

/** Validates a raw env object in full. Throws one Error listing every problem. */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) throw invalid("server environment", result.error.issues);
  return result.data;
}

/** Validates one group of a raw env object. Throws one Error naming the group and its problems. */
export function parseEnvGroup(group: EnvGroup, raw: Record<string, string | undefined>): Partial<ServerEnv> {
  const mask = Object.fromEntries(ENV_GROUPS[group].map((key) => [key, true])) as { [K in EnvKey]?: true };
  const result = serverEnvSchema.pick(mask).safeParse(raw);
  if (!result.success) throw invalid(`server environment (${group})`, result.error.issues);
  return result.data as Partial<ServerEnv>;
}

let cached: Partial<ServerEnv> = {};
const loaded = new Set<EnvGroup>();

function loadGroup(group: EnvGroup): Partial<ServerEnv> {
  if (!loaded.has(group)) {
    cached = { ...cached, ...parseEnvGroup(group, process.env) };
    loaded.add(group);
  }
  return cached;
}

/** Loads and caches every group of the server env from process.env. */
export function getEnv(): ServerEnv {
  for (const group of Object.keys(ENV_GROUPS) as EnvGroup[]) loadGroup(group);
  return cached as ServerEnv;
}

/** Clears the cache. For tests only. */
export function resetEnvCache(): void {
  cached = {};
  loaded.clear();
}

/** Typed, lazily validated server env: `env.PAYPAL_CLIENT_ID` loads and checks the PayPal group. */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    const group = groupOf.get(prop as EnvKey);
    if (!group) return undefined;
    return loadGroup(group)[prop as EnvKey];
  },
});
