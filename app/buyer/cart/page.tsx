import Link from "next/link";
import { Suspense } from "react";

import { CartView, type CartData } from "@/components/buyer/cart-view";
import { signInHref } from "@/components/buyer/hold-messages";
import { DEMO_SALE_SLUG, photoUrl } from "@/components/buyer/listings";
import { canDonate } from "@/components/buyer/sale-info";
import { Badge, ButtonLink, EmptyState, PageContainer, PageHeader, Spinner } from "@/components/ui";
import { env } from "@/lib/env";
import { currentUserId } from "@/lib/repos";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";
import type { CartStatus } from "@/lib/supabase/types";

export default function CartPage() {
  return (
    <PageContainer>
      <PageHeader title="Your cart" description="Items from every table, paid in one checkout." />
      <Suspense
        fallback={
          <div className="flex justify-center py-10 text-ink-soft">
            <Spinner label="Loading your cart" />
          </div>
        }
      >
        <CartContent />
      </Suspense>
    </PageContainer>
  );
}

const PAST_STATUS: Partial<Record<CartStatus, { label: string; tone: "ready" | "held" | "neutral" }>> = {
  paid: { label: "Paid", tone: "ready" },
  partial: { label: "Partly paid", tone: "held" },
  failed: { label: "Not paid", tone: "neutral" },
};

async function loadCarts(db: RummageClient, userId: string): Promise<CartData[] | null> {
  const carts = await db
    .from("carts")
    .select("id, sale_id, status, paypal_order_id, created_at, cart_lines(item_id, household_id, price, hold_expires_at, active)")
    .eq("buyer_user_id", userId)
    .in("status", ["open", "checkout"])
    .order("created_at", { ascending: false });
  if (carts.error) return null;
  if (carts.data.length === 0) return [];

  const saleIds = [...new Set(carts.data.map((cart) => cart.sale_id))];
  const itemIds = [...new Set(carts.data.flatMap((cart) => cart.cart_lines.filter((line) => line.active).map((line) => line.item_id)))];

  const [sales, listings] = await Promise.all([
    db.from("public_sales").select("*").in("id", saleIds),
    itemIds.length > 0
      ? db.from("public_listings").select("item_id, title, household_label, photo_path").in("item_id", itemIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sales.error || listings.error) return null;

  const saleById = new Map(sales.data.map((sale) => [sale.id, sale]));
  const listingById = new Map((listings.data ?? []).map((listing) => [listing.item_id, listing]));

  const result: CartData[] = [];
  for (const cart of carts.data) {
    const sale = saleById.get(cart.sale_id);
    if (!sale || (cart.status !== "open" && cart.status !== "checkout")) continue;
    result.push({
      cartId: cart.id,
      status: cart.status,
      paypalOrderId: cart.paypal_order_id,
      sale: {
        name: sale.name,
        slug: sale.slug,
        fundraiserName: sale.fundraiser_name,
        fundraiserGoal: sale.fundraiser_goal === null ? null : Number(sale.fundraiser_goal),
        canDonate: canDonate(sale),
      },
      lines: cart.cart_lines
        .filter((line) => line.active)
        .map((line) => {
          const listing = listingById.get(line.item_id);
          return {
            itemId: line.item_id,
            householdId: line.household_id,
            householdLabel: listing?.household_label ?? "A table at this sale",
            title: listing?.title ?? "An item",
            price: Number(line.price),
            holdExpiresAt: line.hold_expires_at,
            photoUrl: photoUrl(env.NEXT_PUBLIC_SUPABASE_URL, listing?.photo_path ?? null),
          };
        }),
    });
  }
  return result;
}

async function CartContent() {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) {
    return (
      <EmptyState
        title="Sign in to see your cart"
        description="Your cart keeps the items you hold for 15 minutes while you pay."
        action={<ButtonLink href={signInHref("/buyer/cart")}>Sign in</ButtonLink>}
      />
    );
  }

  const [carts, past] = await Promise.all([
    loadCarts(db, userId),
    db
      .from("carts")
      .select("id, status, created_at, sale_id")
      .eq("buyer_user_id", userId)
      .in("status", ["paid", "partial", "failed"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (carts === null) {
    return (
      <EmptyState
        title="Your cart did not load"
        description="Something went wrong on our side. Refresh the page in a moment."
      />
    );
  }

  const pastOrders = past.data ?? [];
  const pastSaleIds = [...new Set(pastOrders.map((order) => order.sale_id))];
  const pastSales =
    pastSaleIds.length > 0 ? ((await db.from("public_sales").select("id, name").in("id", pastSaleIds)).data ?? []) : [];
  const pastSaleName = new Map(pastSales.map((sale) => [sale.id, sale.name]));

  return (
    <div className="flex flex-col gap-10">
      {carts.length === 0 ? (
        <EmptyState
          title="Your cart is empty"
          description="Hold something at a sale and it waits here for 15 minutes while you pay."
          action={<ButtonLink href={`/sale/${DEMO_SALE_SLUG}`}>Browse the sale</ButtonLink>}
        />
      ) : (
        <CartView carts={carts} clientId={env.NEXT_PUBLIC_PAYPAL_CLIENT_ID} testMode={env.PAYPAL_ENV === "sandbox"} />
      )}

      {pastOrders.length > 0 ? (
        <section aria-labelledby="past-orders" className="flex flex-col gap-3">
          <h2 id="past-orders" className="font-display text-xl font-semibold text-ink">
            Your orders
          </h2>
          <ul className="flex flex-col gap-2">
            {pastOrders.map((order) => {
              const status = PAST_STATUS[order.status];
              return (
                <li key={order.id}>
                  <Link
                    href={`/buyer/orders/${order.id}`}
                    className="flex min-h-tap items-center justify-between gap-3 rounded-sticker border border-line bg-surface px-4 py-3 hover:bg-paper-deep"
                  >
                    <span className="min-w-0 truncate font-semibold text-ink">
                      {pastSaleName.get(order.sale_id) ?? "Your order"}
                    </span>
                    {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
