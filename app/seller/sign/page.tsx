import type { Metadata } from "next";
import { Suspense } from "react";

import { PrintButton } from "@/components/seller/print-button";
import { firstParam, householdQuery } from "@/components/seller/seller-copy";
import { NoTable, SellerLoading, SignedOut } from "@/components/seller/seller-states";
import { qrSvg, tableScanUrl } from "@/components/seller/table-sign";
import { EmptyState, PageContainer, PageHeader } from "@/components/ui";
import { env } from "@/lib/env";

import { loadSellerContext } from "../data";

export const metadata: Metadata = { title: "Table sign · Rummage" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// On paper only the sign is left: the top bar (body > header) and tab bar (body > nav) go.
const PRINT_ONLY_SIGN = "print:[body:has(&)>header]:hidden print:[body:has(&)>nav]:hidden";

async function TableSign({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const context = await loadSellerContext(firstParam(params.household));

  if (context.kind === "signed-out") {
    return <SignedOut next="/seller/sign" description="Sign in to print the sign for your table." />;
  }
  if (context.kind === "no-household") return <NoTable title="Print your table sign" />;

  const { db, household } = context;
  const sale = await db.from("sales").select("slug, name").eq("id", household.sale_id).maybeSingle();
  if (sale.error || !sale.data) {
    return (
      <EmptyState
        title="The sign did not load"
        description="Something went wrong on our side. Refresh the page in a moment."
      />
    );
  }

  const url = tableScanUrl(env.APP_URL, sale.data.slug, household.id);
  const svg = await qrSvg(url);

  return (
    <div className={PRINT_ONLY_SIGN}>
      <PageHeader
        className="print:hidden"
        back={{ href: `/seller${householdQuery(household.id)}`, label: household.label }}
        title="Your table sign"
        description="Print this and tape it to your table. Buyers scan the code, point their camera at an item and see its price."
      />
      <article className="mx-auto flex max-w-xl flex-col items-center gap-6 rounded-sticker border-2 border-ink bg-white p-8 text-center print:max-w-none print:border-0 print:p-0">
        <p className="font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
          Point your camera at anything on this table
        </p>
        <div
          role="img"
          aria-label="QR code that opens the scan page for this table"
          className="w-64 sm:w-72 print:w-96"
          // A server-rendered SVG string from the qrcode package, built from our own URL.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="flex flex-col gap-1">
          <p className="font-display text-2xl font-semibold text-ink">{household.label}</p>
          <p className="text-base text-ink-soft">{sale.data.name}</p>
        </div>
        <p className="text-sm text-ink-soft">Scan the code with your phone camera to see prices and hold items.</p>
      </article>
      <div className="mx-auto mt-6 flex max-w-xl flex-col gap-2 print:hidden">
        <PrintButton>Print the sign</PrintButton>
        <p className="break-all text-center text-sm text-ink-soft">{url}</p>
      </div>
    </div>
  );
}

export default function TableSignPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <Suspense fallback={<SellerLoading />}>
        <TableSign searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
