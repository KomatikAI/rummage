"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

const ERRORS: Record<string, string> = {
  unauthorized: "Your session has ended. Sign in again, then link PayPal.",
  forbidden: "Only this sale's organizer can link PayPal for donations.",
  no_fundraiser: "Add a fundraiser to this sale first.",
};

function errorText(code: unknown): string {
  return (typeof code === "string" && ERRORS[code]) || "PayPal could not start just now. Try again in a moment.";
}

/** Asks for a PayPal sign-up link for the fundraiser and sends the organizer there. */
export function LinkPayPalButton({ saleId, label, variant = "primary" }: { saleId: string; label: string; variant?: "primary" | "secondary" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/paypal/organizer-referral", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saleId }),
      });
      const json: unknown = await response.json().catch(() => null);
      const body = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
      if (response.ok && typeof body.actionUrl === "string") {
        window.location.assign(body.actionUrl);
        return;
      }
      setError(errorText(body.error));
    } catch {
      setError(errorText(undefined));
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant={variant} loading={pending} onClick={start}>
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
