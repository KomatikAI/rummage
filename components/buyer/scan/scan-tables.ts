import type { SaleItem } from "@/components/buyer/listings";

import type { ScanTable } from "./scan-types";

/**
 * Which tables a buyer can scan. WHOLE_SALE_MAX_ITEMS mirrors SCAN_MAX_CANDIDATES in
 * lib/ai/scan-match.ts; it is kept separate so the client bundle never imports the
 * server matcher, and a test pins the two together.
 */
export const WHOLE_SALE_MAX_ITEMS = 24;

/**
 * Every table with something still for sale (listed or held), in first-seen order.
 * Unlike `householdPins`, tables without a map position are included: a buyer standing
 * at a table does not need the map.
 */
export function tableChoices(items: readonly SaleItem[]): ScanTable[] {
  const tables = new Map<string, ScanTable>();
  for (const item of items) {
    if (item.status === "sold") continue;
    const table = tables.get(item.householdId) ?? { householdId: item.householdId, label: item.householdLabel, count: 0 };
    table.count += 1;
    tables.set(item.householdId, table);
  }
  return [...tables.values()];
}

/** True when the whole sale is small enough to scan at once. */
export function canScanWholeSale(tables: readonly ScanTable[]): boolean {
  const total = tables.reduce((sum, table) => sum + table.count, 0);
  return total > 0 && total <= WHOLE_SALE_MAX_ITEMS;
}

/**
 * The table picked when the screen opens: the one in `?household=` when it is scannable,
 * else the only table, else none (the buyer picks one, or scans the whole sale).
 */
export function initialTable(tables: readonly ScanTable[], requested: string | null): string | null {
  if (requested && tables.some((table) => table.householdId === requested)) return requested;
  const only = tables.length === 1 ? tables[0] : undefined;
  return only ? only.householdId : null;
}
