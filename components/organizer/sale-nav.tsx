import Link from "next/link";

const TABS = [
  { key: "dashboard", label: "Dashboard", path: "" },
  { key: "orders", label: "Orders", path: "/orders" },
  { key: "assistant", label: "Assistant", path: "/assistant" },
] as const;

export type SaleNavTab = (typeof TABS)[number]["key"];

/** Dashboard / Orders / Assistant links for one sale. */
export function SaleNav({ saleId, current }: { saleId: string; current: SaleNavTab }) {
  return (
    <nav aria-label="This sale" className="flex flex-wrap gap-2 pb-5">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/organizer/${saleId}${tab.path}`}
          aria-current={tab.key === current ? "page" : undefined}
          className="inline-flex min-h-tap items-center rounded-pill border border-grey-300 bg-surface px-4 text-sm font-semibold text-ink-soft hover:text-ink aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-strong"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
