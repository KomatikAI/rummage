import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantChat } from "@/components/organizer/assistant-chat";
import { formatSaleWhen } from "@/components/organizer/dashboard";
import { OrganizerLoading, OrganizerSignedOut } from "@/components/organizer/organizer-states";
import { SaleNav } from "@/components/organizer/sale-nav";
import { SetSaleName } from "@/components/sale-name";
import { PageContainer, PageHeader } from "@/components/ui";

import { loadOrganizerSale } from "../data";

export const metadata: Metadata = { title: "Assistant · Rummage" };

type Params = Promise<{ saleId: string }>;

async function Assistant({ params }: { params: Params }) {
  const { saleId } = await params;
  const context = await loadOrganizerSale(saleId);
  if (context.kind === "signed-out") return <OrganizerSignedOut next={`/organizer/${saleId}/assistant`} />;
  const { sale } = context;

  return (
    <>
      <SetSaleName name={sale.name} />
      <PageHeader
        back={{ href: `/organizer/${sale.id}`, label: "Dashboard" }}
        eyebrow={formatSaleWhen(sale.sale_date, sale.starts_at, sale.ends_at)}
        title="Assistant"
        description="Questions about this sale, answered from its own numbers."
      />
      <SaleNav saleId={sale.id} current="assistant" />
      <div className="mx-auto w-full max-w-content">
        <AssistantChat saleId={sale.id} />
      </div>
    </>
  );
}

export default function AssistantPage({ params }: { params: Params }) {
  return (
    <PageContainer width="wide">
      <Suspense fallback={<OrganizerLoading />}>
        <Assistant params={params} />
      </Suspense>
    </PageContainer>
  );
}
