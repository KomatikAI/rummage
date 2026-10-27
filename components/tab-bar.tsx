"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { activeNavHref, NAV_ITEMS } from "./nav";
import { NavIcon } from "./nav-icon";
import { cn } from "./ui/cn";

function TabBarView({ activeHref }: { activeHref: string | null }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 h-tabbar border-t border-line bg-surface/95 pb-safe backdrop-blur md:hidden"
    >
      <ul className="grid h-full grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full min-h-tap flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors",
                  active ? "text-accent-strong" : "text-ink-soft hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-pill transition-colors",
                    active && "bg-accent-soft",
                  )}
                >
                  <NavIcon name={item.icon} className="size-5" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveTabBar() {
  return <TabBarView activeHref={activeNavHref(usePathname())} />;
}

/** The phone tab bar: Browse, Cart, Sell, Organize. Hidden from md up, where the top bar carries the links. */
export function TabBar() {
  // usePathname can suspend on dynamic routes under cacheComponents; the fallback is the same bar unhighlighted.
  return (
    <Suspense fallback={<TabBarView activeHref={null} />}>
      <ActiveTabBar />
    </Suspense>
  );
}
