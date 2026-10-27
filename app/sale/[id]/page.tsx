import { Suspense } from "react";

async function SaleHeading({ params }: { params: PageProps<"/sale/[id]">["params"] }) {
  const { id } = await params;
  return <h1 className="text-3xl font-semibold">Sale {id}</h1>;
}

export default function SalePage({ params }: PageProps<"/sale/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Suspense fallback={<h1 className="text-3xl font-semibold">Sale</h1>}>
        <SaleHeading params={params} />
      </Suspense>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">Map and listings will appear here.</p>
    </main>
  );
}
