"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { holdItemAction } from "@/app/sale/[slug]/actions";
import { LazySaleMap } from "@/components/map/lazy";
import { Badge, Button, ButtonLink, cn, EmptyState, formatMoney, Input, Money, Sheet } from "@/components/ui";
import type { ItemCategory } from "@/lib/supabase/types";

import { cartSubtotal, liveLines } from "./cart";
import { useNow } from "./clock";
import { signInHref, type ActionResult } from "./hold-messages";
import { ItemPhoto } from "./item-photo";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  categoriesPresent,
  filterListings,
  householdPins,
  itemCountLabel,
  type SaleItem,
} from "./listings";

export interface SaleBrowserProps {
  sale: { id: string; slug: string };
  items: SaleItem[];
  signedIn: boolean;
  /** The signed-in buyer's live cart in this sale, or null. */
  cart: { itemIds: string[]; lines: { price: number; holdExpiresAt: string }[] } | null;
}

type View = "list" | "map";

const segmentClasses = (active: boolean) =>
  cn(
    "min-h-tap flex-1 rounded-pill px-5 text-sm font-semibold transition-colors",
    active ? "bg-surface text-ink shadow-sticker" : "text-ink-soft hover:text-ink",
  );

const chipClasses = (active: boolean) =>
  cn(
    "inline-flex min-h-tap items-center rounded-pill border px-4 text-sm font-semibold transition-colors",
    active ? "border-ink bg-ink text-paper" : "border-grey-300 bg-surface text-ink hover:bg-paper-deep",
  );

/** The public sale page body: List | Map, search, category chips, item sheet and cart pill. */
export function SaleBrowser({ sale, items, signedIn, cart }: SaleBrowserProps) {
  const router = useRouter();
  const now = useNow();
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<(ActionResult & { itemId: string }) | null>(null);
  const [pending, startTransition] = useTransition();

  const mine = useMemo(() => new Set(cart?.itemIds ?? []), [cart]);
  const pins = useMemo(() => householdPins(items), [items]);
  const categories = useMemo(() => categoriesPresent(items), [items]);
  const visible = useMemo(
    () => filterListings(items, { query, category, householdId }),
    [items, query, category, householdId],
  );
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const household = householdId ? pins.find((pin) => pin.householdId === householdId) ?? null : null;

  const cartLines = cart ? (now === null ? cart.lines : liveLines(cart.lines, now)) : [];
  const cartTotal = cartSubtotal(cartLines);

  function selectHousehold(id: string) {
    setHouseholdId((current) => (current === id ? null : id));
    setView("list");
  }

  function clearFilters() {
    setQuery("");
    setCategory(null);
    setHouseholdId(null);
  }

  function openItem(id: string) {
    setMessage(null);
    setSelectedId(id);
  }

  function closeItem() {
    setSelectedId(null);
    setMessage(null);
  }

  function hold(item: SaleItem) {
    setMessage(null);
    startTransition(async () => {
      const result = await holdItemAction({ saleId: sale.id, itemId: item.id });
      setMessage({ ...result, itemId: item.id });
      if (result.ok) router.refresh();
    });
  }

  const itemMessage = selected && message?.itemId === selected.id ? message : null;

  return (
    <>
      <div className="mb-4 flex md:hidden" role="group" aria-label="Show the sale as">
        <div className="flex w-full rounded-pill bg-paper-deep p-1">
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={segmentClasses(view === "list")}>
            List
          </button>
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")} className={segmentClasses(view === "map")}>
            Map
          </button>
        </div>
      </div>

      <div className="md:grid md:grid-cols-5 md:gap-6">
        <section aria-label="Items" className={cn("md:col-span-3", view === "map" && "hidden md:block")}>
          <div className="flex flex-col gap-3">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this sale"
              aria-label="Search items"
            />
            {categories.length > 1 ? (
              <div role="group" aria-label="Categories" className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)} className={chipClasses(category === null)}>
                  All
                </button>
                {categories.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={category === entry}
                    onClick={() => setCategory((current) => (current === entry ? null : entry))}
                    className={chipClasses(category === entry)}
                  >
                    {CATEGORY_LABELS[entry]}
                  </button>
                ))}
              </div>
            ) : null}
            {household ? (
              <div className="flex items-center justify-between gap-3 rounded-sticker bg-accent-soft py-1 pl-4 pr-1">
                <p className="min-w-0 truncate text-sm font-semibold text-accent-strong">Showing {household.label}</p>
                <Button variant="ghost" size="sm" onClick={() => setHouseholdId(null)}>
                  Show every table
                </Button>
              </div>
            ) : null}
            <p className="text-sm text-ink-soft" aria-live="polite">
              {itemCountLabel(visible.length)}
            </p>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              className="mt-4"
              title="Nothing matches"
              description="Try another word, or clear the filters to see every item."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 pb-20 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
              {visible.map((item) => (
                <li key={item.id}>
                  <ItemCard item={item} mine={mine.has(item.id)} onOpen={() => openItem(item.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Map"
          className={cn(
            "h-112 md:sticky md:top-topbar md:col-span-2 md:block md:h-128 md:self-start md:pt-1",
            view === "list" && "hidden",
          )}
        >
          {pins.length > 0 ? (
            <LazySaleMap pins={pins} selectedHouseholdId={householdId} onSelectHousehold={selectHousehold} />
          ) : (
            <EmptyState title="No tables on the map yet" description="Tables show up here once sellers set their spot." />
          )}
        </section>
      </div>

      <Sheet
        open={selected !== null}
        onClose={closeItem}
        title={selected?.title ?? ""}
        description={selected?.householdLabel}
        footer={selected ? <ItemAction item={selected} mine={mine.has(selected.id)} signedIn={signedIn} slug={sale.slug} pending={pending} onHold={hold} /> : null}
      >
        {selected ? <ItemDetails item={selected} mine={mine.has(selected.id)} message={itemMessage} /> : null}
      </Sheet>

      {cartLines.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-tabbar z-20 flex justify-center px-gutter pb-3 md:bottom-0 md:pb-6">
          <Link
            href="/buyer/cart"
            className="pointer-events-auto inline-flex min-h-tap items-center gap-3 rounded-pill bg-ink px-5 py-2 text-paper shadow-sticker hover:bg-grey-700"
          >
            <span className="font-semibold">Cart</span>
            <span className="text-sm">{itemCountLabel(cartLines.length)}</span>
            <Money amount={cartTotal} className="font-display text-lg font-semibold" />
          </Link>
        </div>
      ) : null}
    </>
  );
}

function statusBadge(item: SaleItem, mine: boolean) {
  if (mine && item.status === "held") return <Badge tone="held">In your cart</Badge>;
  return <Badge status={item.status} />;
}

function PriceSticker({ price, large = false }: { price: number | null; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill bg-accent font-display font-semibold text-on-accent shadow-sticker",
        large ? "px-4 py-1 text-2xl" : "px-2.5 py-0.5 text-lg",
      )}
    >
      {price === null ? <span className="font-sans text-sm">Ask</span> : <Money amount={price} trimWholeDollars zeroLabel="Free" />}
    </span>
  );
}

function ItemCard({ item, mine, onOpen }: { item: SaleItem; mine: boolean; onOpen: () => void }) {
  const sold = item.status === "sold";
  const price = item.price === null ? "price on request" : formatMoney(item.price, { trimWholeDollars: true, zeroLabel: "Free" });
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${item.title}, ${price}, ${item.householdLabel}`}
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-sticker border border-line bg-surface text-left shadow-sticker transition-colors hover:border-grey-400",
        sold && "opacity-60",
      )}
    >
      <div className="relative">
        <ItemPhoto src={item.photoUrl} alt="" className="aspect-square w-full" />
        <span className="absolute top-2 left-2">
          <PriceSticker price={item.price} />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="line-clamp-2 font-semibold leading-snug text-ink">{item.title}</span>
        <span className="truncate text-sm text-ink-soft">{item.householdLabel}</span>
        <span className="mt-auto pt-1">{statusBadge(item, mine)}</span>
      </div>
    </button>
  );
}

function ItemDetails({
  item,
  mine,
  message,
}: {
  item: SaleItem;
  mine: boolean;
  message: ActionResult | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ItemPhoto src={item.photoUrl} alt={item.title} className="aspect-4/3 w-full rounded-sticker" />
      <div className="flex flex-wrap items-center gap-2">
        <PriceSticker price={item.price} large />
        {statusBadge(item, mine)}
        <Badge tone="neutral">{CONDITION_LABELS[item.condition]}</Badge>
        <Badge tone="neutral">{CATEGORY_LABELS[item.category]}</Badge>
      </div>
      {item.description ? <p className="text-base text-ink">{item.description}</p> : null}
      {!item.acceptsPayments && item.status !== "sold" ? (
        <p className="rounded-sticker bg-paper-deep p-3 text-sm text-ink-soft">
          This table is not set up for checkout yet. You can still buy it in person on the sale day.
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
    </div>
  );
}

function ItemAction({
  item,
  mine,
  signedIn,
  slug,
  pending,
  onHold,
}: {
  item: SaleItem;
  mine: boolean;
  signedIn: boolean;
  slug: string;
  pending: boolean;
  onHold: (item: SaleItem) => void;
}) {
  if (mine && item.status === "held") {
    return (
      <ButtonLink href="/buyer/cart" fullWidth size="lg">
        Go to your cart
      </ButtonLink>
    );
  }
  if (item.status === "sold") {
    return (
      <Button fullWidth size="lg" variant="secondary" disabled>
        Already sold
      </Button>
    );
  }
  if (item.status === "held") {
    return (
      <Button fullWidth size="lg" variant="secondary" disabled>
        Someone is holding this
      </Button>
    );
  }
  if (!item.acceptsPayments) {
    return (
      <Button fullWidth size="lg" variant="secondary" disabled>
        Pay at the table
      </Button>
    );
  }
  if (!signedIn) {
    return (
      <ButtonLink href={signInHref(`/sale/${slug}`)} fullWidth size="lg">
        Sign in to hold it
      </ButtonLink>
    );
  }
  return (
    <Button fullWidth size="lg" loading={pending} onClick={() => onHold(item)}>
      Hold for 15 minutes
    </Button>
  );
}
