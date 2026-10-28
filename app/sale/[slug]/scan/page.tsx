import { Suspense } from "react";

import { signInHref } from "@/components/buyer/hold-messages";
import { toSaleItem } from "@/components/buyer/listings";
import { ScanScreen } from "@/components/buyer/scan/scan-screen";
import { canScanWholeSale, initialTable, tableChoices } from "@/components/buyer/scan/scan-tables";
import { SetSaleName } from "@/components/sale-name";
import { ButtonLink, EmptyState, PageContainer, PageHeader, Spinner } from "@/components/ui";
import { env } from "@/lib/env";
import { currentUserId } from "@/lib/repos";
import { getPublicListings } from "@/lib/supabase/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ScanPageProps = PageProps<"/sale/[slug]/scan">;

export default function ScanPage({ params, searchParams }: ScanPageProps) {
  return (
    <PageContainer>
      <Suspense fallback={<ScanLoading />}>
        <ScanContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

function ScanLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-16 rounded-sticker bg-paper-deep" />
      <div className="flex items-center justify-center py-10 text-ink-soft">
        <Spinner label="Loading the sale" />
      </div>
    </div>
  );
}

async function ScanContent({ params, searchParams }: Pick<ScanPageProps, "params" | "searchParams">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const requested = typeof query.household === "string" ? query.household : null;
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

  const saleHref = `/sale/${encodeURIComponent(sale.slug)}`;
  const scanHref = `${saleHref}/scan${requested ? `?household=${encodeURIComponent(requested)}` : ""}`;
  const header = (
    <PageHeader
      back={{ href: saleHref, label: sale.name }}
      title="Scan a table"
      description="Point your camera at anything on the table to see its price."
    />
  );

  if (!userId) {
    return (
      <>
        <SetSaleName name={sale.name} />
        {header}
        <EmptyState
          title="Sign in to scan"
          description="Scanning matches your photo against the items at the table, so it needs you signed in."
          action={<ButtonLink href={signInHref(scanHref)}>Sign in</ButtonLink>}
        />
      </>
    );
  }

  const tables = tableChoices(rows.map((row) => toSaleItem(row, env.NEXT_PUBLIC_SUPABASE_URL)));

  return (
    <>
      <SetSaleName name={sale.name} />
      {header}
      {sale.status !== "open" ? (
        <p className="mb-4 rounded-sticker bg-paper-deep p-3 text-sm text-ink-soft">
          {sale.status === "closed"
            ? "This sale has ended. You can still look around."
            : "This sale is not open yet. You can look around, and holds open on the day."}
        </p>
      ) : null}
      {tables.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Sellers are still setting out their tables. Check back soon."
          action={
            <ButtonLink href={saleHref} variant="secondary">
              Back to the sale
            </ButtonLink>
          }
        />
      ) : (
        <ScanScreen
          sale={{ id: sale.id, slug: sale.slug, open: sale.status === "open" }}
          tables={tables}
          wholeSale={canScanWholeSale(tables)}
          initialHouseholdId={initialTable(tables, requested)}
        />
      )}
    </>
  );
}
