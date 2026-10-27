import type { Metadata } from "next";
import { Suspense } from "react";

import { ItemCard } from "@/components/seller/item-card";
import { PickupForm } from "@/components/seller/pickup-form";
import { firstParam, householdQuery } from "@/components/seller/seller-copy";
import { NoTable, SellerLoading, SignedOut } from "@/components/seller/seller-states";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui";

import { loadHouseholdItems, loadSellerContext, photoUrl } from "../data";

export const metadata: Metadata = { title: "Pickups · Rummage" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Pickup({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const context = await loadSellerContext(firstParam(params.household));

  if (context.kind === "signed-out") {
    return <SignedOut next="/seller/pickup" description="Sign in to hand over paid items." />;
  }
  if (context.kind === "no-household") return <NoTable title="Pickups" />;

  const { db, household } = context;
  const query = householdQuery(household.id);
  const waiting = (await loadHouseholdItems(db, household.id)).filter((item) => item.status === "sold");

  return (
    <>
      <PageHeader
        back={{ href: `/seller${query}`, label: household.label }}
        title="Hand over"
        description="When a buyer arrives, type the code from their phone. If it matches, give them their things."
      />
      <div className="flex flex-col gap-8">
        <PickupForm householdId={household.id} />

        <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
          <h2 id="waiting-heading" className="font-display text-xl font-semibold text-ink">
            Waiting for pickup <span className="font-sans text-base font-normal text-ink-faint">({waiting.length})</span>
          </h2>
          {waiting.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              description="When a buyer pays for one of your items, it shows up here until they collect it."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {waiting.map((item) => (
                <li key={item.id}>
                  <ItemCard item={item} photoSrc={photoUrl(db, item.photo_path)} href={`/seller/items/${item.id}${query}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function PickupPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <Suspense fallback={<SellerLoading />}>
        <Pickup searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
