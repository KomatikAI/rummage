"use client";

import { useState, type FormEvent } from "react";

import { Button, Field, Input, Sheet, Textarea } from "@/components/ui";

import { Notice } from "./notice";
import { parseRefundInput, REFUND_REASON_MAX_LENGTH, refundErrorMessage, refundSuccessMessage } from "./orders";

type FieldErrors = Partial<Record<"captureId" | "reason", string>>;

/**
 * "Refund a payment": a sheet that takes the PayPal transaction id from the buyer's
 * receipt and posts it to /api/paypal/refund. The route checks that the caller is this
 * sale's organizer (or the paid seller) before PayPal is asked for anything.
 */
export function RefundSheet() {
  const [open, setOpen] = useState(false);
  const [captureId, setCaptureId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = parseRefundInput(captureId, reason);
    if (!input.ok) {
      setErrors({ [input.field]: input.message });
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const response = await fetch("/api/paypal/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.body),
      });
      const json: unknown = await response.json().catch(() => null);
      const body = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
      if (response.ok) {
        setResult(refundSuccessMessage(typeof body.refundStatus === "string" ? body.refundStatus : ""));
        setCaptureId("");
        setReason("");
        setOpen(false);
      } else {
        setFormError(refundErrorMessage(typeof body.error === "string" ? body.error : undefined));
      }
    } catch {
      setFormError(refundErrorMessage(undefined));
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="danger" onClick={() => setOpen(true)} className="w-fit">
        Refund a payment
      </Button>
      {result ? <Notice tone="ready">{result}</Notice> : null}
      <Sheet
        open={open}
        onClose={close}
        title="Refund a payment"
        description="The whole payment goes back to the buyer and the item is no longer sold. This cannot be undone."
        footer={
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" form="refund-form" variant="danger" loading={pending} fullWidth>
              Refund payment
            </Button>
            <Button variant="secondary" onClick={close} fullWidth>
              Keep it
            </Button>
          </div>
        }
      >
        <form id="refund-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field
            label="PayPal transaction id"
            hint="It is on the buyer's PayPal receipt, for example 3C679366HH908993F."
            error={errors.captureId}
            required
          >
            <Input
              name="captureId"
              value={captureId}
              onChange={(event) => setCaptureId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Note for the buyer" optional error={errors.reason}>
            <Textarea
              name="reason"
              rows={3}
              maxLength={REFUND_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
        </form>
      </Sheet>
    </div>
  );
}
