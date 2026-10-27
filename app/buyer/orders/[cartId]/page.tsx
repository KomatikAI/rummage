import { Suspense } from "react";

import { AutoRefresh } from "@/components/buyer/auto-refresh";
import { signInHref } from "@/components/buyer/hold-messages";
import {
  buildReceipt,
  OUTCOME_COPY,
  orderOutcome,
  PAYMENT_BADGE,
  type OrderOutcome,
  type ReceiptHousehold,
} from "@/components/buyer/orders";
import { LazyPickupMap } from "@/components/map/lazy";
import { Badge, ButtonLink, Card, CardTitle, cn, EmptyState, Money, PageContainer, PageHeader, Spinner } from "@/components/ui";
import { currentUserId, isUuid } from "@/lib/repos";
import { getMyPickups } from "@/lib/supabase/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function OrderPage({ params }: PageProps<"/buyer/orders/[cartId]">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <div className="flex justify-center py-10 text-ink-soft">
            <Spinner label="Loading your order" />
          </div>
        }
      >
        <OrderContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

const BANNER_TONE: Record<OrderOutcome, string> = {
  all_paid: "bg-ready-soft text-ready-strong",
  partial: "bg-held-soft text-held",
  none: "bg-paper-deep text-ink",
  checking: "bg-paper-deep text-ink",
};

function NotFound() {
  return (
    <>
      <PageHeader title="Your order" back={{ href: "/buyer/cart", label: "Cart" }} />
      <EmptyState
        title="We could not find that order"
        description="It may belong to another account. Your cart lists your recent orders."
        action={<ButtonLink href="/buyer/cart">Go to your cart</ButtonLink>}
      />
    </>
  );
}

async function OrderContent({ params }: { params: PageProps<"/buyer/orders/[cartId]">["params"] }) {
  const { cartId } = await params;
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) {
    return (
      <>
        <PageHeader title="Your order" />
        <EmptyState
          title="Sign in to see this order"
          description="Your pickup codes show here once you sign in."
          action={<ButtonLink href={signInHref(`/buyer/orders/${cartId}`)}>Sign in</ButtonLink>}
        />
      </>
    );
  }
  if (!isUuid(cartId)) return <NotFound />;

  const cart = await db
    .from("carts")
    .select("id, status, sale_id, cart_lines(item_id, household_id, price)")
    .eq("id", cartId)
    .eq("buyer_user_id", userId)
    .maybeSingle();
  if (cart.error || !cart.data) return <NotFound />;

  const itemIds = cart.data.cart_lines.map((line) => line.item_id);
  const [units, sale, listings, pickups] = await Promise.all([
    db.from("purchase_units").select("household_id, amount, capture_status").eq("cart_id", cartId),
    db.from("public_sales").select("name, slug").eq("id", cart.data.sale_id).maybeSingle(),
    itemIds.length > 0
      ? db.from("public_listings").select("item_id, title, household_label").in("item_id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    getMyPickups(db).catch(() => []),
  ]);

  // Client columns only (no pickup_code); codes come from get_my_pickups.
  const unitRows = units.data ?? [];
  const listingById = new Map((listings.data ?? []).map((listing) => [listing.item_id, listing]));

  const receiptUnits = unitRows.map((unit) => ({
    householdId: unit.household_id,
    amount: Number(unit.amount),
    captureStatus: unit.capture_status,
  }));
  const { households, donation } = buildReceipt({
    units: receiptUnits,
    lines: cart.data.cart_lines.map((line) => ({
      itemId: line.item_id,
      householdId: line.household_id,
      householdLabel: listingById.get(line.item_id)?.household_label ?? "",
      title: listingById.get(line.item_id)?.title ?? "An item",
      price: Number(line.price),
    })),
    pickups: pickups.filter((pickup) => pickup.cart_id === cartId),
  });

  const outcome = orderOutcome(cart.data.status, receiptUnits.filter((unit) => unit.householdId !== null));
  const copy = OUTCOME_COPY[outcome];
  const total = households.reduce((sum, household) => (household.payment === "paid" ? sum + household.amount : sum), 0) +
    (donation?.payment === "paid" ? donation.amount : 0);

  return (
    <>
      {outcome === "checking" ? <AutoRefresh /> : null}
      <PageHeader
        eyebrow={sale.data?.name}
        title="Your order"
        back={sale.data ? { href: `/sale/${sale.data.slug}`, label: "Back to the sale" } : { href: "/buyer/cart", label: "Cart" }}
      />

      <div className="flex flex-col gap-4">
        <div role="status" className={cn("flex items-start gap-3 rounded-sticker p-4", BANNER_TONE[outcome])}>
          {outcome === "checking" ? <Spinner size="md" label={null} className="mt-1" /> : null}
          <div className="flex flex-col gap-1">
            <p className="font-display text-xl font-semibold">{copy.title}</p>
            <p className="text-sm">{copy.body}</p>
          </div>
        </div>

        {households.map((household) => (
          <HouseholdCard key={household.householdId} household={household} />
        ))}

        {donation ? (
          <Card tone="sunken" className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle as="h2">Your gift</CardTitle>
              <Badge status={PAYMENT_BADGE[donation.payment].status}>{PAYMENT_BADGE[donation.payment].label}</Badge>
            </div>
            <Money amount={donation.amount} className="font-semibold text-ink" />
          </Card>
        ) : null}

        <div className="flex items-baseline justify-between border-t border-line pt-4">
          <span className="font-semibold text-ink">Paid in total</span>
          <Money amount={total} className="font-display text-2xl font-semibold text-ink" />
        </div>
      </div>
    </>
  );
}

function HouseholdCard({ household }: { household: ReceiptHousehold }) {
  const badge = PAYMENT_BADGE[household.payment];
  const paid = household.payment === "paid";
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle as="h2" className="truncate">
            {household.label}
          </CardTitle>
          <Badge status={badge.status}>{badge.label}</Badge>
        </div>
        <Money amount={household.amount} className="font-semibold text-ink" />
      </div>

      <ul className="flex flex-col gap-1 px-4 py-3">
        {household.items.map((item) => (
          <li key={item.itemId} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{item.title}</span>
            {item.price !== null ? <Money amount={item.price} className="text-ink-soft" /> : null}
          </li>
        ))}
      </ul>

      {paid ? (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
          {household.pickupCode ? (
            <div className="flex flex-col items-center gap-1 rounded-sticker bg-paper-deep py-4">
              <p className="text-sm font-semibold text-ink-soft">Pickup code</p>
              <p className="font-display text-5xl font-semibold tracking-widest text-ink tabular-nums">{household.pickupCode}</p>
              <p className="text-sm text-ink-soft">Show this code at the table</p>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Your pickup code shows here in a moment.</p>
          )}
          {household.lng !== null && household.lat !== null ? (
            <LazyPickupMap lng={household.lng} lat={household.lat} label={`Where to find ${household.label}`} />
          ) : null}
        </div>
      ) : household.payment === "not_paid" ? (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">Nothing was charged for this table.</p>
      ) : null}
    </Card>
  );
}
