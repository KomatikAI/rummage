"use client";

import Link from "next/link";
import type { Ref } from "react";

import { CONDITION_LABELS, type SaleItem } from "@/components/buyer/listings";
import { Badge, Button, ButtonLink, cn, formatMoney, Money } from "@/components/ui";

import type { ActionResult } from "../hold-messages";
import type { ScanResult } from "./scan-view";
import type { ScanTable } from "./scan-types";

/** The cart page, where a held item is paid for. */
const CART_HREF = "/buyer/cart";

export interface ScanCardProps {
  ref?: Ref<HTMLDivElement>;
  result: ScanResult;
  /** False while a new scan is in flight: the card fades out. */
  visible: boolean;
  /** The sale is open, so items can be held. */
  saleOpen: boolean;
  /** Items this buyer held from this screen. */
  heldByMe: ReadonlySet<string>;
  holdPending: boolean;
  holdMessage: (ActionResult & { itemId: string }) | null;
  signInHref: string;
  onHold: (item: SaleItem) => void;
  onChoose: (item: SaleItem) => void;
  onPickTable: (householdId: string) => void;
  /** Computed overlay position in the camera view, in pixels. */
  position: { left: number; top: number };
  /** The card has been measured, so its position is real. */
  placed: boolean;
}

function PriceSticker({ amount }: { amount: number | null }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-pill bg-accent px-3 py-1 font-display text-xl font-semibold text-on-accent shadow-sticker">
      {amount === null ? "Ask" : <Money amount={amount} trimWholeDollars zeroLabel="Free" />}
    </span>
  );
}

function HoldAction({
  item,
  saleOpen,
  heldByMe,
  holdPending,
  onHold,
}: Pick<ScanCardProps, "saleOpen" | "heldByMe" | "holdPending" | "onHold"> & { item: SaleItem }) {
  if (heldByMe.has(item.id)) {
    return (
      <ButtonLink href={CART_HREF} fullWidth>
        Go to your cart
      </ButtonLink>
    );
  }
  if (item.status === "held") return null;
  if (!saleOpen) return <p className="text-sm text-ink-soft">Holding opens when the sale does.</p>;
  if (!item.acceptsPayments) return <p className="text-sm text-ink-soft">Pay at the table for this one.</p>;
  return (
    <Button fullWidth loading={holdPending} onClick={() => onHold(item)}>
      Hold for 15 minutes
    </Button>
  );
}

function MatchBody(props: Omit<ScanCardProps, "ref"> & { item: SaleItem }) {
  const { item, heldByMe, holdMessage } = props;
  const mine = heldByMe.has(item.id);
  const message = holdMessage && holdMessage.itemId === item.id ? holdMessage : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug text-ink">{item.title}</h2>
          <p className="text-sm text-ink-soft">{CONDITION_LABELS[item.condition]}</p>
        </div>
        <PriceSticker amount={item.price} />
      </div>
      {item.description ? <p className="truncate text-sm text-ink-soft">{item.description}</p> : null}
      <div>
        {mine ? (
          <Badge tone="held">In your cart</Badge>
        ) : item.status === "held" ? (
          <Badge tone="held">On hold</Badge>
        ) : (
          <Badge status="available" />
        )}
      </div>
      <HoldAction {...props} />
      {message ? (
        <p
          role="status"
          className={cn(
            "rounded-field px-3 py-2 text-sm",
            message.ok ? "bg-ready-soft text-ready-strong" : "bg-danger-soft text-danger-strong",
          )}
        >
          {message.message}
        </p>
      ) : null}
    </div>
  );
}

function ChooseBody({ options, onChoose }: { options: SaleItem[]; onChoose: (item: SaleItem) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold text-ink">Is it one of these?</h2>
      <ul className="flex flex-col gap-2">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => onChoose(option)}
              className="flex min-h-tap w-full items-center justify-between gap-3 rounded-field border border-grey-300 bg-surface px-3 text-left text-sm font-semibold text-ink hover:bg-paper-deep"
            >
              <span className="truncate">{option.title}</span>
              <span className="shrink-0 font-display">
                {option.price === null ? "Ask" : <Money amount={option.price} trimWholeDollars zeroLabel="Free" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotListedBody({ title, priceLow, priceHigh }: { title: string; priceLow: number; priceHigh: number }) {
  const low = formatMoney(priceLow, { trimWholeDollars: true });
  const high = formatMoney(priceHigh, { trimWholeDollars: true });
  return (
    <div className="flex flex-col gap-2">
      <Badge tone="outline">Estimate — not listed at this table</Badge>
      <p className="text-base text-ink">
        Not listed here — looks like <span className="font-semibold">{title}</span>, about{" "}
        <span className="font-display font-semibold">{low === high ? low : `${low}–${high}`}</span>
      </p>
      <p className="text-sm text-ink-soft">Ask the seller for the real price.</p>
    </div>
  );
}

function PickTableBody({ tables, onPickTable }: { tables: ScanTable[]; onPickTable: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold text-ink">Pick your table first</h2>
      <p className="text-sm text-ink-soft">This sale has too many items to match at once.</p>
      <div className="flex flex-wrap gap-2">
        {tables.map((table) => (
          <Button key={table.householdId} variant="secondary" size="sm" onClick={() => onPickTable(table.householdId)}>
            {table.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The price card floating over the camera view. */
export function ScanCard(props: ScanCardProps) {
  const { ref, ...rest } = props;
  const { result, visible, position, placed, signInHref, onChoose, onPickTable } = rest;
  return (
    <div
      ref={ref}
      aria-live="polite"
      className={cn(
        "absolute z-10 w-80 max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] overflow-y-auto rounded-sticker border-2 border-accent bg-surface p-4 shadow-sticker transition-opacity duration-200 motion-reduce:transition-none",
        visible && placed ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      // The one computed style: where the card sits over the moving camera view.
      style={{ left: position.left, top: position.top }}
    >
      {result.kind === "match" ? <MatchBody {...rest} item={result.item} /> : null}
      {result.kind === "choose" ? <ChooseBody options={result.options} onChoose={onChoose} /> : null}
      {result.kind === "notListed" ? <NotListedBody {...result} /> : null}
      {result.kind === "pickTable" ? <PickTableBody tables={result.tables} onPickTable={onPickTable} /> : null}
      {result.kind === "nothing" ? (
        <p className="text-sm text-ink">Nothing listed here matches. Point at one thing, a little closer, and scan again.</p>
      ) : null}
      {result.kind === "error" ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-danger-strong">
            {result.message}
          </p>
          {result.signIn ? (
            <Link href={signInHref} className="text-sm font-semibold text-accent-strong underline">
              Sign in
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
