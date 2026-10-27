import { Money, type MoneyAmount } from "@/components/ui";

/** The accent price sticker on a seller's item. */
export function PriceSticker({ amount }: { amount: MoneyAmount }) {
  return (
    <span className="inline-flex items-center rounded-pill bg-accent px-2.5 py-0.5 font-display text-base font-semibold text-on-accent">
      <Money amount={amount} trimWholeDollars zeroLabel="Free" />
    </span>
  );
}
