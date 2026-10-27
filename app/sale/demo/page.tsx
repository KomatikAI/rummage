import { redirect } from "next/navigation";

import { DEMO_SALE_SLUG } from "@/components/buyer/listings";

/** The shell links to /sale/demo; the demo sale lives at its real slug. */
export default function DemoSalePage(): never {
  redirect(`/sale/${DEMO_SALE_SLUG}`);
}
