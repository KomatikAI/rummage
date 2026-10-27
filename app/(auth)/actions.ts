"use server";

import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { friendlyAuthError, safeNext, validateCredentials, type AuthFormState } from "./auth-helpers";

function readForm(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  return { email, password, next };
}

/** Email + password sign-in. Redirects to `next` (default /sale/demo) on success. */
export async function signIn(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readForm(formData);

  const fieldErrors = validateCredentials(email, password, "sign-in");
  if (fieldErrors) return { email, fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { email, formError: friendlyAuthError(error) };

  redirect(next);
}

/** Email + password sign-up. Signs in straight away, or asks the user to confirm their email. */
export async function signUp(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const { email, password, next } = readForm(formData);

  const fieldErrors = validateCredentials(email, password, "sign-up");
  if (fieldErrors) return { email, fieldErrors };

  const supabase = await createSupabaseServerClient();
  const callback = new URL("/auth/callback", env.APP_URL);
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error) return { email, formError: friendlyAuthError(error) };

  // With email confirmation off, Supabase signs the user in immediately.
  if (data.session) redirect(next);

  return {
    email,
    notice: `We sent a link to ${email}. Open it on this device to finish signing up.`,
  };
}

/** Signs out and returns to the landing page. Used by the top bar and /sign-out. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
