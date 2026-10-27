"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { activeNavHref, NAV_ITEMS } from "./nav";
import { cn } from "./ui/cn";

function TopNavView({ activeHref }: { activeHref: string | null }) {
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-tap items-center rounded-pill px-3.5 text-sm font-semibold transition-colors",
                  active ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-paper-deep hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveTopNav() {
  return <TopNavView activeHref={activeNavHref(usePathname())} />;
}

/** The same four links as the tab bar, inline in the top bar from md up. */
export function TopNav() {
  return (
    <Suspense fallback={<TopNavView activeHref={null} />}>
      <ActiveTopNav />
    </Suspense>
  );
}
