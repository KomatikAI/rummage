"use client";

import {
  PayPalButtons,
  PayPalScriptProvider,
  usePayPalScriptReducer,
  type PayPalButtonsComponentProps,
  type ReactPayPalScriptOptions,
} from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ButtonLink, cn, Spinner } from "@/components/ui";

import {
  CHECKOUT_CANCELLED_MESSAGE,
  CHECKOUT_ERROR_MESSAGE,
  captureErrorMessage,
  createOrderErrorMessage,
  errorCode,
  parseCaptureResponse,
  parseCreateOrderResponse,
} from "./checkout-messages";

/** Loads the checkout script once for the page. No merchant ids here: the server builds the order. */
export function CheckoutProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const options: ReactPayPalScriptOptions = {
    clientId,
    currency: "USD",
    intent: "capture",
    enableFunding: "venmo",
    buyerCountry: "US",
    components: "buttons",
  };
  return <PayPalScriptProvider options={options}>{children}</PayPalScriptProvider>;
}

type Notice = { tone: "info" | "error"; text: string; showOrderLink?: boolean };

export interface CheckoutButtonsProps {
  cartId: string;
  /** The order already started for this cart (cart status `checkout`), reused on retry. */
  initialOrderId: string | null;
  /** Whole cents, or null while the typed donation is not valid. */
  donationCents: number | null;
  /** True while the cart is empty or anything else blocks paying. */
  disabled: boolean;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { ok: response.ok, body: parsed };
}

/**
 * The checkout buttons for one cart. createOrder posts to /api/paypal/create-order (or
 * reuses the order a cancelled attempt left behind), onApprove posts to
 * /api/paypal/capture and then opens the order page.
 */
export function CheckoutButtons({ cartId, initialOrderId, donationCents, disabled }: CheckoutButtonsProps) {
  const router = useRouter();
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  const orderIdRef = useRef<string | null>(initialOrderId);
  const donationRef = useRef<number | null>(donationCents);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    donationRef.current = donationCents;
  }, [donationCents]);

  useEffect(() => {
    if (initialOrderId) orderIdRef.current = initialOrderId;
  }, [initialOrderId]);

  const createOrder: PayPalButtonsComponentProps["createOrder"] = async () => {
    setNotice(null);
    if (orderIdRef.current) return orderIdRef.current;
    const cents = donationRef.current;
    if (cents === null) {
      const text = "Fix the donation amount first, then pay.";
      setNotice({ tone: "error", text });
      throw new Error(text);
    }
    setBusy(true);
    try {
      const result = await postJson("/api/paypal/create-order", { cartId, donationCents: cents });
      const order = result.ok ? parseCreateOrderResponse(result.body) : null;
      if (!order) {
        const code = errorCode(result.body);
        const text = createOrderErrorMessage(code);
        setNotice({ tone: "error", text });
        if (code === "cart_not_open") router.refresh();
        throw new Error(text);
      }
      orderIdRef.current = order.orderId;
      return order.orderId;
    } finally {
      setBusy(false);
    }
  };

  const onApprove: PayPalButtonsComponentProps["onApprove"] = async (data) => {
    setBusy(true);
    setNotice({ tone: "info", text: "Confirming your payment. This takes a few seconds." });
    try {
      const result = await postJson("/api/paypal/capture", { orderId: data.orderID });
      const capture = result.ok ? parseCaptureResponse(result.body) : null;
      if (!capture) {
        setNotice({ tone: "error", text: captureErrorMessage(errorCode(result.body)), showOrderLink: true });
        setBusy(false);
        return;
      }
      router.push(`/buyer/orders/${cartId}`);
    } catch {
      setNotice({ tone: "error", text: captureErrorMessage(null), showOrderLink: true });
      setBusy(false);
    }
  };

  const onError: PayPalButtonsComponentProps["onError"] = () => {
    setBusy(false);
    setNotice((current) => (current?.tone === "error" ? current : { tone: "error", text: CHECKOUT_ERROR_MESSAGE }));
  };

  const onCancel: PayPalButtonsComponentProps["onCancel"] = () => {
    setBusy(false);
    setNotice({ tone: "info", text: CHECKOUT_CANCELLED_MESSAGE });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {isPending ? (
        <div className="flex min-h-tap items-center justify-center gap-2 text-sm text-ink-soft">
          <Spinner size="sm" label={null} />
          Loading checkout
        </div>
      ) : null}
      {isRejected ? (
        <p role="alert" className="rounded-sticker bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
          Checkout could not load. Check your connection, then refresh the page.
        </p>
      ) : null}
      <div aria-busy={busy || undefined} className={cn(busy && "opacity-55")}>
        <PayPalButtons
          style={{ layout: "vertical", shape: "pill", label: "pay" }}
          disabled={disabled || busy}
          forceReRender={[cartId]}
          createOrder={createOrder}
          onApprove={onApprove}
          onError={onError}
          onCancel={onCancel}
        />
      </div>
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex flex-col gap-2 rounded-sticker p-3 text-sm font-semibold",
            notice.tone === "error" ? "bg-danger-soft text-danger-strong" : "bg-paper-deep text-ink",
          )}
        >
          <p>{notice.text}</p>
          {notice.showOrderLink ? (
            <ButtonLink href={`/buyer/orders/${cartId}`} variant="secondary" size="sm" className="w-fit">
              See your order
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
