import type { Metadata } from "next";
import { Suspense } from "react";

import { EditItemForm } from "@/components/seller/edit-item-form";
import { itemIdSchema, priceToInput, CATEGORY_LABELS, CONDITION_LABELS } from "@/components/seller/forms";
import { ItemPhoto } from "@/components/seller/item-photo";
import { canEditItem, lockedReason } from "@/components/seller/item-status";
import { ItemStatusActions } from "@/components/seller/item-status-actions";
import { Notice } from "@/components/seller/notice";
import { PriceSticker } from "@/components/seller/price-sticker";
import { householdQuery, firstParam } from "@/components/seller/seller-copy";
import { NoTable, SellerLoading, SignedOut } from "@/components/seller/seller-states";
import { Badge, ButtonLink, EmptyState, itemStatusBadge, PageContainer, PageHeader } from "@/components/ui";

import { loadSellerContext, photoUrl } from "../../data";

export const metadata: Metadata = { title: "Your item · Rummage" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function SellerItem({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const context = await loadSellerContext(firstParam(query.household));

  if (context.kind === "signed-out") {
    return <SignedOut next={`/seller/items/${encodeURIComponent(id)}`} description="Sign in to change your item." />;
  }
  if (context.kind === "no-household") return <NoTable title="Your item" />;

  const { db, households } = context;
  const itemId = itemIdSchema.safeParse(id);
  // Only the seller's own households: RLS would also show an organizer other tables' items.
  const { data: item, error } = itemId.success
    ? await db
        .from("items")
        .select("*")
        .eq("id", itemId.data)
        .in(
          "household_id",
          households.map((household) => household.id),
        )
        .maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error(`load item: ${error.message}`);

  if (!item) {
    return (
      <>
        <PageHeader title="Item not found" back={{ href: "/seller", label: "Your table" }} />
        <EmptyState
          title="We could not find that item"
          description="It may have been deleted, or it belongs to another table."
          action={
            <ButtonLink href="/seller" variant="primary">
              Back to your items
            </ButtonLink>
          }
        />
      </>
    );
  }

  const household = households.find((entry) => entry.id === item.household_id) ?? context.household;
  const locked = lockedReason(item.status);

  return (
    <>
      <PageHeader back={{ href: `/seller${householdQuery(household.id)}`, label: household.label }} title={item.title} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <ItemPhoto
            src={photoUrl(db, item.photo_path)}
            alt={item.title}
            sizes="(min-width: 640px) 36rem, 100vw"
            className="w-full"
          />
          <div className="flex flex-wrap items-center gap-2">
            {item.price !== null ? <PriceSticker amount={item.price} /> : null}
            <Badge status={itemStatusBadge(item.status)} />
            <span className="text-sm text-ink-soft">
              {CATEGORY_LABELS[item.category]} · {CONDITION_LABELS[item.condition]}
            </span>
          </div>
        </div>

        {locked ? <Notice tone="pending">{locked}</Notice> : null}

        {canEditItem(item.status) ? (
          <EditItemForm
            itemId={item.id}
            initial={{ title: item.title, description: item.description ?? "", price: priceToInput(item.price) }}
          />
        ) : item.description ? (
          <p className="text-base text-ink">{item.description}</p>
        ) : null}

        <ItemStatusActions itemId={item.id} title={item.title} status={item.status} />
      </div>
    </>
  );
}

export default function SellerItemPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageContainer>
      <Suspense fallback={<SellerLoading />}>
        <SellerItem params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
