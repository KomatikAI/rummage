import { Suspense } from "react";

import { AssistantChat } from "@/components/buyer/assistant-chat";
import { signInHref } from "@/components/buyer/hold-messages";
import { DEMO_SALE_SLUG } from "@/components/buyer/listings";
import { SetSaleName } from "@/components/sale-name";
import { ButtonLink, EmptyState, PageContainer, PageHeader, Spinner } from "@/components/ui";
import { currentUserId } from "@/lib/repos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function AssistantPage({ searchParams }: PageProps<"/buyer/assistant">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <div className="flex justify-center py-10 text-ink-soft">
            <Spinner label="Loading the helper" />
          </div>
        }
      >
        <AssistantContent searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function AssistantContent({ searchParams }: { searchParams: PageProps<"/buyer/assistant">["searchParams"] }) {
  const params = await searchParams;
  const requested = typeof params.sale === "string" && params.sale.length > 0 ? params.sale : DEMO_SALE_SLUG;
  const next = `/buyer/assistant?sale=${encodeURIComponent(requested)}`;

  const db = await createSupabaseServerClient();
  const [userId, sale] = await Promise.all([
    currentUserId(db),
    db.from("public_sales").select("id, slug, name, status").eq("slug", requested).maybeSingle(),
  ]);

  if (!sale.data) {
    return (
      <>
        <PageHeader title="Shopping helper" />
        <EmptyState
          title="We could not find that sale"
          description="Open the helper from a sale page to shop that sale."
          action={<ButtonLink href={`/sale/${DEMO_SALE_SLUG}`}>Browse the sale</ButtonLink>}
        />
      </>
    );
  }

  const header = (
    <PageHeader
      eyebrow={sale.data.name}
      title="Shopping helper"
      description="Ask in your own words. It finds things and holds them; you pay from your cart."
      back={{ href: `/sale/${sale.data.slug}`, label: "Back to the sale" }}
    />
  );

  if (!userId) {
    return (
      <>
        <SetSaleName name={sale.data.name} />
        {header}
        <EmptyState
          title="Sign in to shop with the helper"
          description="The helper holds items in your cart, so it needs to know who you are."
          action={<ButtonLink href={signInHref(next)}>Sign in</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <SetSaleName name={sale.data.name} />
      {header}
      {sale.data.status === "open" ? (
        <AssistantChat saleId={sale.data.id} saleSlug={sale.data.slug} saleName={sale.data.name} />
      ) : (
        <EmptyState
          title="This sale is not open"
          description="The helper can hold items only while the sale is open."
          action={<ButtonLink href={`/sale/${sale.data.slug}`}>Look around the sale</ButtonLink>}
        />
      )}
    </>
  );
}
