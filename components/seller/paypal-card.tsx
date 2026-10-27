import { Badge, Card, CardTitle } from "@/components/ui";
import type { HouseholdRow } from "@/lib/supabase/types";

import { LinkPayPalButton } from "./link-paypal-button";
import { paypalCardView } from "./seller-copy";

/** The seller's PayPal link status: link it, finish it, or a green ready badge. */
export function PayPalCard({
  household,
}: {
  household: Pick<HouseholdRow, "id" | "paypal_status" | "paypal_payments_receivable" | "paypal_email_confirmed">;
}) {
  const view = paypalCardView(household);

  return (
    <Card padding="md" tone={view.state === "ready" ? "surface" : "sunken"} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <CardTitle>{view.title}</CardTitle>
        {view.state === "ready" ? <Badge status="ready">Linked</Badge> : null}
        {view.state === "pending" ? <Badge status="pending">Almost done</Badge> : null}
      </div>
      <p className="text-sm text-ink-soft">{view.body}</p>
      {view.missing.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
          {view.missing.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {view.action ? (
        <LinkPayPalButton
          householdId={household.id}
          label={view.action}
          variant={view.state === "pending" ? "secondary" : "primary"}
        />
      ) : null}
    </Card>
  );
}
