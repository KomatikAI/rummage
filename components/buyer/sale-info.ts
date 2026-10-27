/**
 * Pure formatting for the sale header: the date line and the fundraiser line.
 * Dates are calendar dates (no time zone); times are Postgres `time` strings.
 */

/** "2026-11-14" -> "Saturday, November 14". Null for a missing or malformed date. */
export function formatSaleDate(saleDate: string | null): string | null {
  if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return null;
  const date = new Date(`${saleDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "08:00:00" -> "8 am", "14:30" -> "2:30 pm", "12:00" -> "noon". */
export function formatSaleTime(time: string | null): string | null {
  const match = time?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  if (hours === 12 && minutes === 0) return "noon";
  const suffix = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${hour12} ${suffix}` : `${hour12}:${match[2]} ${suffix}`;
}

/** "Saturday, November 14 · 8 am to 2 pm", or whichever parts exist. */
export function saleWhenLine(saleDate: string | null, startsAt: string | null, endsAt: string | null): string | null {
  const date = formatSaleDate(saleDate);
  const start = formatSaleTime(startsAt);
  const end = formatSaleTime(endsAt);
  const times = start && end ? `${start} to ${end}` : start ? `from ${start}` : null;
  if (date && times) return `${date} · ${times}`;
  return date ?? times;
}

/** The fundraiser line under the header, or null when the sale has no fundraiser. */
export function fundraiserLine(fundraiserName: string | null, acceptsDonations: boolean): string | null {
  if (!fundraiserName) return null;
  return acceptsDonations
    ? `Raising money for ${fundraiserName}. You can add a gift at checkout.`
    : `Raising money for ${fundraiserName}.`;
}

/** Whether the cart shows the donation field: a fundraiser that can actually be paid. */
export function canDonate(sale: { fundraiser_name: string | null; accepts_donations: boolean }): boolean {
  return sale.fundraiser_name !== null && sale.accepts_donations;
}
