import Link from "next/link";

import { Badge, itemStatusBadge } from "@/components/ui";
import type { ItemRow } from "@/lib/supabase/types";

import { ItemPhoto } from "./item-photo";
import { PriceSticker } from "./price-sticker";

/** One row in the seller's item list. The whole row opens the item. */
export function ItemCard({
  item,
  photoSrc,
  href,
}: {
  item: Pick<ItemRow, "id" | "title" | "price" | "status">;
  photoSrc: string | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-tap items-center gap-3 rounded-sticker border border-line bg-surface p-3 shadow-sticker transition-colors hover:bg-paper-deep"
    >
      <ItemPhoto src={photoSrc} alt="" sizes="80px" className="w-20" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="truncate font-display text-base font-semibold text-ink">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {item.price !== null ? <PriceSticker amount={item.price} /> : null}
          <Badge status={itemStatusBadge(item.status)} />
        </div>
      </div>
      <span aria-hidden="true" className="text-ink-faint">
        →
      </span>
    </Link>
  );
}
