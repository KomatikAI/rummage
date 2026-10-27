"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { releaseHoldAction } from "@/app/buyer/cart/actions";
import { Button, ButtonLink, Card, CardTitle, cn, EmptyState, Field, formatMoney, Input, Money } from "@/components/ui";

import {
  cartSubtotal,
  countdownLabel,
  DONATION_PRESETS,
  donationCents,
  earliestExpiry,
  formatCountdown,
  grandTotal,
  groupByHousehold,
  liveLines,
  secondsLeft,
  type CartItemLine,
  type DonationChoice,
} from "./cart";
import { cancelCheckout, CheckoutButtons, CheckoutProvider } from "./checkout-buttons";
import {
  CHECKOUT_START_OVER_LABEL,
  CHECKOUT_TRY_AGAIN_LABEL,
  CHECKOUT_UNFINISHED_TEXT,
  CHECKOUT_UNFINISHED_TITLE,
  cancelErrorMessage,
} from "./checkout-messages";
import { useNow } from "./clock";
import type { ActionResult } from "./hold-messages";
import { ItemPhoto } from "./item-photo";

export type CartData = {
  cartId: string;
  status: "open" | "checkout";
  paypalOrderId: string | null;
  sale: {
    name: string;
    slug: string;
    fundraiserName: string | null;
    /** Dollars. */
    fundraiserGoal: number | null;
    canDonate: boolean;
  };
  lines: CartItemLine[];
};

export interface CartViewProps {
  carts: CartData[];
  /** NEXT_PUBLIC_PAYPAL_CLIENT_ID; empty when checkout is not configured. */
  clientId: string;
  /** True when payments run against the test environment. */
  testMode: boolean;
}

const chipClasses = (active: boolean) =>
  cn(
    "inline-flex min-h-tap min-w-16 items-center justify-center rounded-pill border px-4 text-sm font-semibold transition-colors",
    active ? "border-ink bg-ink text-paper" : "border-grey-300 bg-surface text-ink hover:bg-paper-deep",
  );

/** Every live cart the buyer has (one per sale), each with its own checkout. */
export function CartView({ carts, clientId, testMode }: CartViewProps) {
  return (
    <CheckoutProvider clientId={clientId}>
      <div className="flex flex-col gap-8">
        {carts.map((cart) => (
          <SaleCart
            key={cart.cartId}
            cart={cart}
            checkoutReady={clientId.length > 0}
            showSaleName={carts.length > 1}
            testMode={testMode}
          />
        ))}
      </div>
    </CheckoutProvider>
  );
}

function SaleCart({
  cart,
  checkoutReady,
  showSaleName,
  testMode,
}: {
  cart: CartData;
  checkoutReady: boolean;
  showSaleName: boolean;
  testMode: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  const [message, setMessage] = useState<ActionResult | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [startingOver, setStartingOver] = useState(false);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const [choice, setChoice] = useState<DonationChoice>(0);
  const [custom, setCustom] = useState("");

  const inCheckout = cart.status === "checkout";
  // An open cart drops expired holds; in checkout the lines are frozen into the order.
  const lines = inCheckout || now === null ? cart.lines : liveLines(cart.lines, now);
  const groups = groupByHousehold(lines);
  const subtotal = cartSubtotal(lines);
  const expiry = earliestExpiry(lines);
  const left = expiry && now !== null ? secondsLeft(expiry, now) : null;

  const showDonation = cart.sale.canDonate && !inCheckout;
  const donation = showDonation ? donationCents(choice, custom) : ({ ok: true, cents: 0 } as const);
  const total = grandTotal(subtotal, donation.ok ? donation.cents : 0);

  function release(itemId: string) {
    setMessage(null);
    setReleasing(itemId);
    startTransition(async () => {
      const result = await releaseHoldAction({ cartId: cart.cartId, itemId });
      setMessage(result);
      setReleasing(null);
      router.refresh();
    });
  }

  /** "Try again": the checkout below already reuses the saved order, so bring it into view. */
  function tryAgain() {
    checkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    checkoutRef.current?.focus({ preventScroll: true });
  }

  /** "Start over": drop the saved order so the cart can be edited again. */
  async function startOver() {
    setMessage(null);
    setStartingOver(true);
    const { outcome, code } = await cancelCheckout(cart.cartId);
    if (outcome === "capture_started") {
      router.push(`/buyer/orders/${cart.cartId}`);
      return;
    }
    if (outcome === "failed") setMessage({ ok: false, message: cancelErrorMessage(code) });
    setStartingOver(false);
    router.refresh();
  }

  if (lines.length === 0) {
    return (
      <EmptyState
        title={showSaleName ? `Nothing held at ${cart.sale.name}` : "Your holds ran out"}
        description="Holds last 15 minutes. Go back to the sale to pick something again."
        action={<ButtonLink href={`/sale/${cart.sale.slug}`}>Back to the sale</ButtonLink>}
      />
    );
  }

  return (
    <section aria-label={`Cart for ${cart.sale.name}`} className="flex flex-col gap-4">
      {showSaleName ? <h2 className="font-display text-xl font-semibold text-ink">{cart.sale.name}</h2> : null}

      {inCheckout ? (
        <div role="status" className="flex flex-col gap-3 rounded-sticker bg-paper-deep p-3 text-sm text-ink">
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{CHECKOUT_UNFINISHED_TITLE}</p>
            <p className="text-ink-soft">{CHECKOUT_UNFINISHED_TEXT}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={tryAgain} disabled={startingOver || !checkoutReady}>
              {CHECKOUT_TRY_AGAIN_LABEL}
            </Button>
            <Button variant="secondary" size="sm" loading={startingOver} onClick={() => void startOver()}>
              {CHECKOUT_START_OVER_LABEL}
            </Button>
          </div>
        </div>
      ) : left !== null ? (
        <p
          className={cn(
            "flex items-center justify-between gap-3 rounded-sticker p-3 text-sm font-semibold",
            left <= 120 ? "bg-held-soft text-held" : "bg-paper-deep text-ink",
          )}
        >
          <span>First hold ends in</span>
          <span className="font-display text-xl tabular-nums" aria-label={countdownLabel(left)}>
            {formatCountdown(left)}
          </span>
        </p>
      ) : null}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "rounded-sticker p-3 text-sm font-semibold",
            message.ok ? "bg-ready-soft text-ready-strong" : "bg-danger-soft text-danger-strong",
          )}
        >
          {message.message}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <li key={group.householdId}>
            <Card padding="none">
              <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
                <CardTitle as="h3" className="min-w-0 truncate">
                  {group.label}
                </CardTitle>
                <Money amount={group.subtotal} className="font-semibold text-ink" />
              </div>
              <ul className="divide-y divide-line">
                {group.lines.map((line) => (
                  <li key={line.itemId} className="flex items-center gap-3 px-4 py-3">
                    <ItemPhoto src={line.photoUrl} alt="" className="size-14 shrink-0 rounded-field" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold text-ink">{line.title}</span>
                      <Money amount={line.price} className="text-sm text-ink-soft" />
                    </div>
                    {inCheckout ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={releasing === line.itemId}
                        disabled={releasing !== null}
                        onClick={() => release(line.itemId)}
                        aria-label={`Remove ${line.title}`}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>

      {cart.sale.fundraiserName && !inCheckout ? (
        <Card tone="sunken" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle as="h3">Add a gift for {cart.sale.fundraiserName}</CardTitle>
            {cart.sale.fundraiserGoal !== null ? (
              <p className="text-sm text-ink-soft">
                The goal for this sale is <Money amount={cart.sale.fundraiserGoal} trimWholeDollars />.
              </p>
            ) : null}
          </div>
          {showDonation ? (
            <>
              <div role="group" aria-label="Gift amount" className="flex flex-wrap gap-2">
                {DONATION_PRESETS.map((preset) => (
                  <button key={preset} type="button" aria-pressed={choice === preset} onClick={() => setChoice(preset)} className={chipClasses(choice === preset)}>
                    {formatMoney(preset, { trimWholeDollars: true })}
                  </button>
                ))}
                <button type="button" aria-pressed={choice === "custom"} onClick={() => setChoice("custom")} className={chipClasses(choice === "custom")}>
                  Other
                </button>
              </div>
              {choice === "custom" ? (
                <Field label="Your gift in dollars" error={donation.ok ? undefined : donation.message} hint="Optional. Up to $1,000.">
                  <Input inputMode="decimal" autoComplete="off" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="7.50" />
                </Field>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-ink-soft">Gifts at checkout are not open for this sale yet.</p>
          )}
        </Card>
      ) : null}

      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <div className="flex items-baseline justify-between text-sm text-ink-soft">
          <span>Items</span>
          <Money amount={subtotal} />
        </div>
        {showDonation && donation.ok && donation.cents > 0 ? (
          <div className="flex items-baseline justify-between text-sm text-ink-soft">
            <span>Gift</span>
            <Money amount={donation.cents / 100} />
          </div>
        ) : null}
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-ink">{inCheckout ? "Items total" : "Total"}</span>
          <Money amount={total} className="font-display text-2xl font-semibold text-ink" />
        </div>
      </div>

      {checkoutReady ? (
        <div ref={checkoutRef} tabIndex={-1} role="group" aria-label="Checkout">
          <CheckoutButtons
            cartId={cart.cartId}
            initialOrderId={inCheckout ? cart.paypalOrderId : null}
            donationCents={donation.ok ? donation.cents : null}
            disabled={lines.length === 0 || !donation.ok || releasing !== null || startingOver}
          />
        </div>
      ) : (
        <p className="rounded-sticker bg-paper-deep p-3 text-sm text-ink-soft">Checkout is not set up here yet.</p>
      )}
      {testMode ? <p className="text-center text-xs text-ink-faint">Test mode: no real money moves.</p> : null}
    </section>
  );
}
