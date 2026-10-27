/** Where a signed-in shopper lands when no `next` is given. */
export const DEFAULT_AFTER_SIGN_IN = "/sale/demo";

export interface AuthFormState {
  /** A plain sentence for the whole form, such as a wrong password. */
  formError?: string;
  fieldErrors?: { email?: string; password?: string };
  /** Shown instead of the form when sign-up needs an email confirmation. */
  notice?: string;
  /** Echoed back so a failed submit keeps what was typed. Never the password. */
  email?: string;
}

/**
 * Accepts only a same-site path ("/seller", "/sale/demo?x=1"). Anything else, such as
 * "https://elsewhere.example", "//elsewhere.example" or "/\\elsewhere", falls back.
 */
export function safeNext(next: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof next !== "string") return fallback;
  const value = next.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

/** Checks the form before it reaches Supabase. Returns field errors, or null when it looks fine. */
export function validateCredentials(
  email: string,
  password: string,
  mode: "sign-in" | "sign-up",
): AuthFormState["fieldErrors"] | null {
  const errors: NonNullable<AuthFormState["fieldErrors"]> = {};
  if (!email) errors.email = "Enter your email.";
  else if (!EMAIL.test(email)) errors.email = "That email does not look right.";
  if (!password) errors.password = "Enter your password.";
  else if (mode === "sign-up" && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** Turns a Supabase auth error into one plain sentence. */
export function friendlyAuthError(error: { message?: string; code?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password do not match. Try again.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Check your inbox and confirm your email first.";
  }
  if (code === "user_already_exists" || message.includes("already registered")) {
    return "That email already has an account. Sign in instead.";
  }
  if (code === "weak_password" || message.includes("password should")) {
    return "Pick a longer password, with a mix of letters and numbers.";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) {
    return "Too many tries. Wait a minute, then try again.";
  }
  return "Something went wrong. Try again in a moment.";
}
