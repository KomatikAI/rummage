import type { Metadata } from "next";
import { Suspense } from "react";

import { CopyButton } from "@/components/organizer/copy-button";
import {
  formatSaleWhen,
  householdRows,
  householdsReadyLine,
  inviteLink,
  inviteReminder,
  linkPayPalLabel,
  linkStateLook,
  onboardingNotice,
  paidOrdersLine,
  readOnboardingParam,
  saleStatusHint,
  saleStatusLook,
  statusActions,
  summaryStats,
} from "@/components/organizer/dashboard";
import { LinkPayPalButton } from "@/components/organizer/link-paypal-button";
import { Notice } from "@/components/organizer/notice";
import { OrganizerLoading, OrganizerSignedOut } from "@/components/organizer/organizer-states";
import { ReleaseHolds } from "@/components/organizer/release-holds";
import { SaleNav } from "@/components/organizer/sale-nav";
import { SegmentedProgress } from "@/components/organizer/segmented-progress";
import { StatusForm } from "@/components/organizer/status-form";
import { SetSaleName } from "@/components/sale-name";
import { Badge, Card, CardTitle, Money, PageContainer, PageHeader, toDollars } from "@/components/ui";
import { env } from "@/lib/env";
import type { ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";

import { releaseExpiredHolds, setSaleStatus } from "./actions";
import { loadOrganizerSale, loadSummary, type OrganizerSale } from "./data";

export const metadata: Metadata = { title: "Sale dashboard · Rummage" };

type Params = Promise<{ saleId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function SummaryStrip({ summary }: { summary: ParsedOrganizerSummary }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {summaryStats(summary).map((stat) => (
        <Card key={stat.key} padding="sm" className={stat.key === "gross" ? "col-span-2 sm:col-span-1" : undefined}>
          <dt className="text-sm text-ink-soft">{stat.label}</dt>
          <dd className="font-display text-2xl font-semibold text-ink">
            {stat.money ? <Money amount={stat.value} /> : <span className="tabular-nums">{stat.value}</span>}
          </dd>
        </Card>
      ))}
    </dl>
  );
}

function HouseholdsTable({ summary, sale, link }: { summary: ParsedOrganizerSummary; sale: OrganizerSale; link: string }) {
  const rows = householdRows(summary);
  return (
    <section aria-labelledby="households-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="households-heading" className="font-display text-xl font-semibold text-ink">
          Households
        </h2>
        <p className="text-sm text-ink-soft">{householdsReadyLine(summary)}</p>
      </div>
      {rows.length === 0 ? null : (
        <Card padding="none" className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper-deep text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Household
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  PayPal
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Listed
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Sold
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const look = linkStateLook(row.linkState);
                return (
                  <tr key={row.id} className="align-top">
                    <th scope="row" className="px-3 py-2 font-normal">
                      <span className="block font-semibold text-ink">{row.label}</span>
                      {row.paused ? <span className="block text-xs text-ink-faint">Paused</span> : null}
                      <CopyButton
                        variant="ghost"
                        className="-ml-3.5 text-ink-soft"
                        label="Copy reminder"
                        aria-label={`Copy a reminder for ${row.label}`}
                        value={inviteReminder({ label: row.label, saleName: sale.name, link, linkState: row.linkState })}
                      />
                    </th>
                    <td className="px-3 py-2">
                      <Badge tone={look.tone}>{look.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.itemsListed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.itemsSold}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function InviteCard({ link, token }: { link: string; token: string }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <CardTitle>Invite households</CardTitle>
        <p className="text-sm text-ink-soft">Send this link to every household that wants a table. They join and list from their phone.</p>
      </div>
      <p className="break-all rounded-field bg-paper-deep px-3 py-2 font-mono text-sm text-ink">{link}</p>
      <CopyButton value={link} label="Copy invite link" />
      <p className="text-sm text-ink-soft">
        Invite code: <span className="break-all font-mono text-ink">{token}</span>
      </p>
    </Card>
  );
}

function FundraiserCard({ sale, summary }: { sale: OrganizerSale & { fundraiser_name: string }; summary: ParsedOrganizerSummary }) {
  const linked = sale.organizer_merchant_id !== null;
  const goal = toDollars(sale.fundraiser_goal);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{sale.fundraiser_name}</CardTitle>
          <p className="text-sm text-ink-soft">
            {linked
              ? "PayPal is linked. Buyers can add a donation at checkout."
              : "Link PayPal for the fundraiser so buyers can add a donation at checkout."}
          </p>
        </div>
        <Badge tone={linked ? "ready" : "neutral"}>{linked ? "Linked" : "Not linked"}</Badge>
      </div>
      {linked ? null : <LinkPayPalButton saleId={sale.id} label={linkPayPalLabel(sale.fundraiser_name)} />}
      <div className="flex flex-col gap-2">
        <p className="text-base text-ink">
          <Money amount={summary.fundraiser_total} className="font-display text-2xl font-semibold" />
          {goal !== null ? (
            <span className="text-ink-soft">
              {" "}
              of <Money amount={goal} /> goal
            </span>
          ) : (
            <span className="text-ink-soft"> raised</span>
          )}
        </p>
        <SegmentedProgress raised={summary.fundraiser_total} goal={goal} />
        <p className="text-sm text-ink-soft">{paidOrdersLine(summary.paid_order_count)}</p>
      </div>
    </Card>
  );
}

async function Dashboard({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { saleId } = await params;
  const context = await loadOrganizerSale(saleId);
  if (context.kind === "signed-out") return <OrganizerSignedOut next={`/organizer/${saleId}`} />;

  const { db, sale } = context;
  const [summary, query] = await Promise.all([loadSummary(db, sale.id), searchParams]);
  const onboarding = readOnboardingParam(query.onboarding);
  const look = saleStatusLook(sale.status);
  const link = inviteLink(env.APP_URL, sale.invite_token);
  const fundraiserName = sale.fundraiser_name;

  return (
    <>
      <SetSaleName name={sale.name} />
      <PageHeader
        back={{ href: "/organizer", label: "Your sales" }}
        eyebrow={formatSaleWhen(sale.sale_date, sale.starts_at, sale.ends_at)}
        title={sale.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={look.tone}>{look.label}</Badge>
            <span>{saleStatusHint(sale.status)}</span>
          </span>
        }
        actions={<StatusForm saleId={sale.id} actions={statusActions(sale.status)} action={setSaleStatus} />}
      />
      <SaleNav saleId={sale.id} current="dashboard" />

      <div className="flex flex-col gap-6">
        {onboarding ? (
          <Notice tone={onboarding === "ready" ? "ready" : "pending"}>{onboardingNotice(onboarding, fundraiserName)}</Notice>
        ) : null}

        <SummaryStrip summary={summary} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-6">
            <HouseholdsTable summary={summary} sale={sale} link={link} />
            <Card tone="sunken" className="flex flex-col gap-2">
              <CardTitle as="h3">Holds</CardTitle>
              <p className="text-sm text-ink-soft">
                A hold keeps an item for a buyer for 15 minutes while they pay. If an item still shows as held after
                that, put it back on sale here.
              </p>
              <ReleaseHolds saleId={sale.id} action={releaseExpiredHolds} />
            </Card>
          </div>
          <div className="flex flex-col gap-6">
            <InviteCard link={link} token={sale.invite_token} />
            {fundraiserName ? <FundraiserCard sale={{ ...sale, fundraiser_name: fundraiserName }} summary={summary} /> : null}
          </div>
        </div>
      </div>
    </>
  );
}

export default function SaleDashboardPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<OrganizerLoading />}>
        <Dashboard params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
