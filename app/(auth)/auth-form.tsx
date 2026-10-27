"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Card, Field, Input, SubmitButton } from "@/components/ui";

import { signIn, signUp } from "./actions";
import { MIN_PASSWORD_LENGTH, type AuthFormState } from "./auth-helpers";

export interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  /** A same-site path, already checked with safeNext. */
  next: string;
  /** A message carried in the URL, for example after an expired email link. */
  initialError?: string;
}

const copy = {
  "sign-in": {
    submit: "Sign in",
    pending: "Signing in",
    passwordHint: undefined,
    autocomplete: "current-password",
    switchText: "New to Rummage?",
    switchLink: "Create an account",
    switchHref: "/sign-up",
  },
  "sign-up": {
    submit: "Create account",
    pending: "Creating your account",
    passwordHint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
    autocomplete: "new-password",
    switchText: "Already have an account?",
    switchLink: "Sign in",
    switchHref: "/sign-in",
  },
} as const;

export function AuthForm({ mode, next, initialError }: AuthFormProps) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(mode === "sign-in" ? signIn : signUp, {
    formError: initialError,
  });
  const text = copy[mode];
  const switchHref = next ? `${text.switchHref}?next=${encodeURIComponent(next)}` : text.switchHref;

  if (state.notice) {
    return (
      <Card padding="lg" className="flex flex-col gap-2" role="status">
        <h2 className="font-display text-xl font-semibold">Check your email</h2>
        <p className="text-ink-soft">{state.notice}</p>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        {state.formError ? (
          <p role="alert" className="rounded-field bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {state.formError}
          </p>
        ) : null}
        <Field label="Email" error={state.fieldErrors?.email} required>
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.email}
          />
        </Field>
        <Field label="Password" hint={text.passwordHint} error={state.fieldErrors?.password} required>
          <Input name="password" type="password" autoComplete={text.autocomplete} />
        </Field>
        <SubmitButton fullWidth size="lg" pendingLabel={text.pending}>
          {text.submit}
        </SubmitButton>
      </form>
      <p className="text-center text-sm text-ink-soft">
        {text.switchText}{" "}
        <Link href={switchHref} className="font-semibold text-accent-strong underline underline-offset-4">
          {text.switchLink}
        </Link>
      </p>
    </Card>
  );
}
