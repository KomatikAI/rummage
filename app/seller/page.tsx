import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ItemCard } from "@/components/seller/item-card";
import { groupItemsByStatus } from "@/components/seller/item-status";
import { JoinSaleForm } from "@/components/seller/join-sale-form";
import { Notice } from "@/components/seller/notice";
import { PayPalCard } from "@/components/seller/paypal-card";
import { firstParam, householdQuery, onboardingNotice } from "@/components/seller/seller-copy";
import { SellerLoading, SignedOut } from "@/components/seller/seller-states";
import { ButtonLink, EmptyState, PageContainer, PageHeader } from "@/components/ui";

import { loadHouseholdItems, loadSellerContext, photoUrl } from "./data";

export const metadata: Metadata = { title: "Your table · Rummage" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function SellerDashboard({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = firstParam(params.household);
  const context = await loadSellerContext(requested);

  if (context.kind === "signed-out") {
    return <SignedOut next="/seller" description="Sign in to list your things and see who has paid." />;
  }

  if (context.kind === "no-household") {
    return (
      <>
        <PageHeader title="Sell at a sale" description="Join your neighborhood sale, then add your things with a photo." />
        <JoinSaleForm initialInviteCode={firstParam(params.invite) ?? ""} />
      </>
    );
  }

  const { db, household, households, saleName } = context;
  const items = await loadHouseholdItems(db, household.id);
  const groups = groupItemsByStatus(items);
  const query = householdQuery(household.id);
  const notice = onboardingNotice(firstParam(params.onboarding), requested, household.id);
  const needsPayPal = household.paypal_status === "unlinked" || household.paypal_status === "revoked";
  const waiting = items.filter((item) => item.status === "sold").length;

  return (
    <>
      <PageHeader
        eyebrow={saleName ?? undefined}
        title={household.label}
        description={items.length === 1 ? "1 item" : `${items.length} items`}
        actions={
          <ButtonLink href={`/seller/new${query}`} variant={needsPayPal ? "secondary" : "primary"} fullWidth>
            Add item
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-6">
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

        {households.length > 1 ? (
          <nav aria-label="Your tables" className="flex flex-wrap gap-2">
            {households.map((entry) => (
              <Link
                key={entry.id}
                href={`/seller${householdQuery(entry.id)}`}
                aria-current={entry.id === household.id ? "page" : undefined}
                className="inline-flex min-h-tap items-center rounded-pill border border-grey-300 bg-surface px-4 text-sm font-semibold text-ink-soft aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-strong"
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <PayPalCard household={household} />

        <ButtonLink href={`/seller/sign${query}`} variant="secondary" size="sm" className="self-start">
          Print your table sign
        </ButtonLink>

        {waiting > 0 ? (
          <ButtonLink href={`/seller/pickup${query}`} variant="secondary" fullWidth>
            {waiting === 1 ? "Hand over 1 paid item" : `Hand over ${waiting} paid items`}
          </ButtonLink>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing listed yet"
            description="Take a photo of something you want to sell. We suggest a name and a price, and you choose."
            action={
              <ButtonLink href={`/seller/new${query}`} variant="secondary">
                Add your first item
              </ButtonLink>
            }
          />
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-labelledby={`group-${group.key}`} className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id={`group-${group.key}`} className="font-display text-xl font-semibold text-ink">
                  {group.title} <span className="font-sans text-base font-normal text-ink-faint">({group.items.length})</span>
                </h2>
                <p className="text-sm text-ink-soft">{group.hint}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <ItemCard item={item} photoSrc={photoUrl(db, item.photo_path)} href={`/seller/items/${item.id}${query}`} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

export default function SellerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <Suspense fallback={<SellerLoading />}>
        <SellerDashboard searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
