/** The four places in Rummage. The tab bar (phones) and the top nav (laptops) both use this. */
export const NAV_ITEMS = [
  { href: "/sale/demo", label: "Browse", icon: "browse", match: "/sale" },
  { href: "/buyer/cart", label: "Cart", icon: "cart", match: "/buyer" },
  { href: "/seller", label: "Sell", icon: "sell", match: "/seller" },
  { href: "/organizer", label: "Organize", icon: "organize", match: "/organizer" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavIcon = NavItem["icon"];

/** The href of the nav item that owns this pathname, or null on pages outside the four. */
export function activeNavHref(pathname: string | null | undefined): NavItem["href"] | null {
  if (!pathname) return null;
  const item = NAV_ITEMS.find((entry) => pathname === entry.match || pathname.startsWith(`${entry.match}/`));
  return item ? item.href : null;
}
