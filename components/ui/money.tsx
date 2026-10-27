import { cn } from "./cn";
import { formatMoney, toDollars, type FormatMoneyOptions, type MoneyAmount } from "./format-money";

export interface MoneyProps extends FormatMoneyOptions {
  amount: MoneyAmount;
  className?: string;
}

/** Renders a dollar amount with tabular figures. Prices in Rummage are dollars, never cents. */
export function Money({ amount, className, ...options }: MoneyProps) {
  const value = toDollars(amount);
  return (
    <data value={value === null ? "" : value.toFixed(2)} className={cn("tabular-nums", className)}>
      {formatMoney(amount, options)}
    </data>
  );
}
