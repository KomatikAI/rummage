import { Suspense } from "react";

import { SaleBrowser } from "@/components/buyer/sale-browser";
import { toSaleItem } from "@/components/buyer/listings";
import { fundraiserLine, saleWhenLine } from "@/components/buyer/sale-info";
import { SetSaleName } from "@/components/sale-name";
import { ButtonLink, EmptyState, PageContainer, PageHeader, Spinner } from "@/components/ui";
import { env } from "@/lib/env";
import { currentUserId } from "@/lib/repos";
import { getPublicListings } from "@/lib/supabase/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function SalePage({ params }: PageProps<"/sale/[slug]">) {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<SaleLoading />}>
        <SaleContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

function SaleLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-24 rounded-sticker bg-paper-deep" />
      <div className="flex items-center justify-center py-10 text-ink-soft">
        <Spinner label="Loading the sale" />
      </div>
    </div>
  );
}

async function SaleContent({ params }: { params: PageProps<"/sale/[slug]">["params"] }) {
  const { slug } = await params;
  const db = await createSupabaseServerClient();

  const [saleResult, rows, userId] = await Promise.all([
    db.from("public_sales").select("*").eq("slug", slug).maybeSingle(),
    getPublicListings(slug, db).catch(() => null),
    currentUserId(db),
  ]);

  if (saleResult.error || rows === null) {
    return (
      <EmptyState
        title="The sale did not load"
        description="Something went wrong on our side. Refresh the page in a moment."
      />
    );
  }
  const sale = saleResult.data;
  if (!sale) {
    return (
      <EmptyState
        title="We could not find that sale"
        description="The link may be old, or the sale has not been published yet."
        action={<ButtonLink href="/">Go to the start</ButtonLink>}
      />
    );
  }

  let cart: { itemIds: string[]; lines: { price: number; holdExpiresAt: string }[] } | null = null;
  if (userId) {
    const { data } = await db
      .from("carts")
      .select("id, status, cart_lines(item_id, price, hold_expires_at, active)")
      .eq("sale_id", sale.id)
      .eq("buyer_user_id", userId)
      .in("status", ["open", "checkout"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const lines = data.cart_lines.filter((line) => line.active);
      cart = {
        itemIds: lines.map((line) => line.item_id),
        lines: lines.map((line) => ({ price: Number(line.price), holdExpiresAt: line.hold_expires_at })),
      };
    }
  }

  const items = rows.map((row) => toSaleItem(row, env.NEXT_PUBLIC_SUPABASE_URL));
  const when = saleWhenLine(sale.sale_date, sale.starts_at, sale.ends_at);
  const fundraiser = fundraiserLine(sale.fundraiser_name, sale.accepts_donations);

  return (
    <>
      <SetSaleName name={sale.name} />
      <PageHeader
        eyebrow={when}
        title={sale.name}
        description={fundraiser ?? sale.description}
        actions={
          <ButtonLink href={`/buyer/assistant?sale=${encodeURIComponent(sale.slug)}`} variant="secondary" size="sm">
            Ask the shopping helper
          </ButtonLink>
        }
      />
      {sale.status !== "open" ? (
        <p className="mb-4 rounded-sticker bg-paper-deep p-3 text-sm text-ink-soft">
          {sale.status === "closed"
            ? "This sale has ended. You can still look around."
            : "This sale is not open yet. You can look around, and holds open on the day."}
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="No items yet" description="Sellers are still setting out their tables. Check back soon." />
      ) : (
        <SaleBrowser sale={{ id: sale.id, slug: sale.slug }} items={items} signedIn={userId !== null} cart={cart} />
      )}
    </>
  );
}
