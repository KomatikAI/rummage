import type { Metadata } from "next";
import { Suspense } from "react";

import { NewItemFlow } from "@/components/seller/new-item-flow";
import { firstParam, householdQuery } from "@/components/seller/seller-copy";
import { NoTable, SellerLoading, SignedOut } from "@/components/seller/seller-states";
import { PageContainer, PageHeader } from "@/components/ui";

import { loadSellerContext } from "../data";

export const metadata: Metadata = { title: "Add an item · Rummage" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function NewItem({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const context = await loadSellerContext(firstParam(params.household));

  if (context.kind === "signed-out") {
    return <SignedOut next="/seller/new" description="Sign in to add items to your table." />;
  }
  if (context.kind === "no-household") return <NoTable title="Add an item" />;

  const { household } = context;
  return (
    <>
      <PageHeader
        back={{ href: `/seller${householdQuery(household.id)}`, label: household.label }}
        title="Add an item"
        description="Take a photo. We suggest a name and a price, and you have the final say."
      />
      <NewItemFlow householdId={household.id} />
    </>
  );
}

export default function NewItemPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <Suspense fallback={<SellerLoading />}>
        <NewItem searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
