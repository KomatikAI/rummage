import type { SaleItem } from "@/components/buyer/listings";

/**
 * The /api/scan wire shapes, shared by the route and the scan screen. Types only, so the
 * client bundle never pulls in the server route.
 */

export type ScanConfidence = "high" | "medium" | "low";

/** Where the item sits in the frame, as fractions of the frame from its top-left corner. */
export type ScanBox = { x: number; y: number; w: number; h: number };

/** A table (household) a buyer can scan, with how many items are still for sale there. */
export type ScanTable = { householdId: string; label: string; count: number };

export type ScanResponse = {
  match: { item: SaleItem; confidence: ScanConfidence; box: ScanBox | null } | null;
  alternatives: SaleItem[];
  notListed: { title: string; priceLow: number; priceHigh: number } | null;
};

/** The JSON body POSTed to /api/scan. */
export type ScanRequestBody = {
  saleSlug: string;
  householdId?: string;
  frameBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};
