import type { Metadata } from "next";
import { Suspense } from "react";

import { NewSaleForm } from "@/components/organizer/new-sale-form";
import { OrganizerLoading, OrganizerSignedOut } from "@/components/organizer/organizer-states";
import { PageContainer, PageHeader } from "@/components/ui";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createSale } from "./actions";

export const metadata: Metadata = { title: "Start a sale · Rummage" };

async function NewSale() {
  const userId = await currentUserId(await createSupabaseServerClient());
  if (!userId) return <OrganizerSignedOut next="/organizer/new" />;
  return <NewSaleForm action={createSale} />;
}

export default function NewSalePage() {
  return (
    <PageContainer width="wide">
      <div className="mx-auto w-full max-w-content">
        <PageHeader
          back={{ href: "/organizer", label: "Your sales" }}
          title="Start a sale"
          description="A name, a day and a meeting area. You can open it to buyers once households have listed."
        />
        <Suspense fallback={<OrganizerLoading />}>
          <NewSale />
        </Suspense>
      </div>
    </PageContainer>
  );
}
