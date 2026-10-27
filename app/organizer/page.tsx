import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { formatSaleWhen, saleStatusLook } from "@/components/organizer/dashboard";
import { OrganizerLoading, OrganizerSignedOut } from "@/components/organizer/organizer-states";
import { Badge, ButtonLink, Card, EmptyState, PageContainer, PageHeader } from "@/components/ui";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your sales · Rummage" };

function householdCountLine(count: number): string {
  if (count === 0) return "No households yet";
  return count === 1 ? "1 household" : `${count} households`;
}

async function OrganizerSales() {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return <OrganizerSignedOut next="/organizer" />;

  // sales_select also lets members read a sale, so filter to the ones this person organizes.
  const sales = await db
    .from("sales")
    .select("id, name, sale_date, starts_at, ends_at, status")
    .eq("organizer_user_id", userId)
    .order("sale_date", { ascending: false, nullsFirst: false });
  if (sales.error) throw new Error(`organizer: could not list sales (${sales.error.code ?? "unknown"})`);

  const rows = sales.data ?? [];
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const households = await db
      .from("households")
      .select("sale_id")
      .in(
        "sale_id",
        rows.map((sale) => sale.id),
      );
    if (households.error) throw new Error(`organizer: could not count households (${households.error.code ?? "unknown"})`);
    for (const household of households.data ?? []) {
      counts.set(household.sale_id, (counts.get(household.sale_id) ?? 0) + 1);
    }
  }

  return (
    <>
      <PageHeader
        title="Your sales"
        description="Start a sale, invite the households on your street and watch it come together."
        actions={<ButtonLink href="/organizer/new">Start a sale</ButtonLink>}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No sales yet"
          description="Pick a date and a meeting area, then share one link with every household."
          action={<ButtonLink href="/organizer/new">Start a sale</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((sale) => {
            const look = saleStatusLook(sale.status);
            return (
              <li key={sale.id}>
                <Link
                  href={`/organizer/${sale.id}`}
                  className="block rounded-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Card className="flex h-full flex-col gap-2 hover:bg-paper-deep">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-display text-lg font-semibold leading-snug text-ink">{sale.name}</h2>
                      <Badge tone={look.tone}>{look.label}</Badge>
                    </div>
                    <p className="text-sm text-ink-soft">{formatSaleWhen(sale.sale_date, sale.starts_at, sale.ends_at)}</p>
                    <p className="text-sm font-semibold text-ink">{householdCountLine(counts.get(sale.id) ?? 0)}</p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function OrganizerPage() {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<OrganizerLoading />}>
        <OrganizerSales />
      </Suspense>
    </PageContainer>
  );
}
