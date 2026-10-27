"use client";

import { useState } from "react";

import { Button, type ButtonVariant } from "@/components/ui";

import { Notice } from "./notice";
import { partnerReferralErrorMessage } from "./seller-copy";

function isActionUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Asks the server for a fresh PayPal sign-up link and sends the browser there. */
export function LinkPayPalButton({
  householdId,
  label,
  variant = "primary",
}: {
  householdId: string;
  label: string;
  variant?: ButtonVariant;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLink() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/paypal/partner-referral", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      if (!response.ok) {
        setError(partnerReferralErrorMessage(response.status));
        setBusy(false);
        return;
      }
      const body: unknown = await response.json();
      const actionUrl = typeof body === "object" && body !== null ? (body as { actionUrl?: unknown }).actionUrl : undefined;
      if (!isActionUrl(actionUrl)) {
        setError(partnerReferralErrorMessage(502));
        setBusy(false);
        return;
      }
      // Stay busy: the page is leaving for PayPal.
      window.location.assign(actionUrl);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button variant={variant} fullWidth loading={busy} onClick={startLink}>
        {busy ? "Opening PayPal" : label}
      </Button>
    </div>
  );
}
