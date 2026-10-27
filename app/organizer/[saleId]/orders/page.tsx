import type { Metadata } from "next";
import { Suspense } from "react";

import { formatSaleWhen } from "@/components/organizer/dashboard";
import { orderRows, orderTotals } from "@/components/organizer/orders";
import { OrganizerLoading, OrganizerSignedOut } from "@/components/organizer/organizer-states";
import { RefundSheet } from "@/components/organizer/refund-sheet";
import { SaleNav } from "@/components/organizer/sale-nav";
import { SetSaleName } from "@/components/sale-name";
import { Badge, Card, CardTitle, EmptyState, Money, PageContainer, PageHeader } from "@/components/ui";

import { loadOrganizerSale, loadSummary } from "../data";

export const metadata: Metadata = { title: "Orders · Rummage" };

type Params = Promise<{ saleId: string }>;

async function Orders({ params }: { params: Params }) {
  const { saleId } = await params;
  const context = await loadOrganizerSale(saleId);
  if (context.kind === "signed-out") return <OrganizerSignedOut next={`/organizer/${saleId}/orders`} />;

  const { db, sale } = context;
  const summary = await loadSummary(db, sale.id);
  const totals = orderTotals(summary);
  const rows = orderRows(summary);

  const strip = [
    { label: "Paid online", amount: totals.paidOnline },
    { label: "Cash", amount: totals.cash },
    ...(sale.fundraiser_name ? [{ label: "Donations", amount: totals.donations }] : []),
  ];

  return (
    <>
      <SetSaleName name={sale.name} />
      <PageHeader
        back={{ href: `/organizer/${sale.id}`, label: "Dashboard" }}
        eyebrow={formatSaleWhen(sale.sale_date, sale.starts_at, sale.ends_at)}
        title="Orders"
        description="What each household has taken in, online and in cash."
      />
      <SaleNav saleId={sale.id} current="orders" />

      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {strip.map((stat) => (
            <Card key={stat.label} padding="sm">
              <dt className="text-sm text-ink-soft">{stat.label}</dt>
              <dd className="font-display text-2xl font-semibold text-ink">
                <Money amount={stat.amount} />
              </dd>
            </Card>
          ))}
          <Card padding="sm">
            <dt className="text-sm text-ink-soft">Paid orders</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums text-ink">{totals.paidOrders}</dd>
          </Card>
        </dl>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="by-household" className="flex flex-col gap-3">
            <h2 id="by-household" className="font-display text-xl font-semibold text-ink">
              By household
            </h2>
            {rows.length === 0 ? (
              <EmptyState title="No households yet" description="Once households join and sell, their totals show here." />
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                  <li key={row.householdId}>
                    <Card padding="sm" className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-ink">{row.label}</h3>
                        <Badge tone={row.captureState === "captured" ? "ready-soft" : "neutral"}>
                          {row.captureState === "captured" ? "Paid online" : "No online payments"}
                        </Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-ink-soft">Online</dt>
                          <dd className="font-semibold text-ink">
                            <Money amount={row.paidOnline} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-soft">Cash</dt>
                          <dd className="font-semibold text-ink">
                            <Money amount={row.cash} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-soft">Sold</dt>
                          <dd className="font-semibold tabular-nums text-ink">{row.itemsSold}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-soft">Picked up</dt>
                          <dd className="font-semibold tabular-nums text-ink">{row.itemsCollected}</dd>
                        </div>
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Card className="flex h-fit flex-col gap-3">
            <CardTitle>Refunds</CardTitle>
            <p className="text-sm text-ink-soft">
              Each payment goes straight to the household that sold the item, so this page shows totals, not single
              payments. A list of refundable payments is not available here.
            </p>
            <p className="text-sm text-ink-soft">
              To refund one, ask the buyer or the seller for the PayPal transaction id on the receipt and enter it
              below.
            </p>
            <RefundSheet />
          </Card>
        </div>
      </div>
    </>
  );
}

export default function OrdersPage({ params }: { params: Params }) {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<OrganizerLoading />}>
        <Orders params={params} />
      </Suspense>
    </PageContainer>
  );
}
