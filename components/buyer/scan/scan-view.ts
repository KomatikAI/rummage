import type { SaleItem } from "@/components/buyer/listings";

import type { ScanBox, ScanConfidence, ScanResponse, ScanTable } from "./scan-types";

/**
 * What the scan screen shows, as a pure reducer over scan starts and /api/scan replies.
 * Runs in Node too, so it is tested.
 */

/** A settled result: what the card shows between scans. */
export type ScanResult =
  | { kind: "match"; item: SaleItem; confidence: ScanConfidence; box: ScanBox | null }
  /** A low-confidence guess: "Is it one of these?" with the guess first. */
  | { kind: "choose"; options: SaleItem[] }
  | { kind: "notListed"; title: string; priceLow: number; priceHigh: number }
  | { kind: "nothing" }
  | { kind: "pickTable"; tables: ScanTable[] }
  | { kind: "error"; message: string; signIn: boolean };

export type ScanView =
  | { kind: "idle" }
  /** In flight; the previous card (if any) fades out. */
  | { kind: "scanning"; previous: ScanResult | null }
  | ScanResult;

export type ScanAction =
  | { type: "start" }
  | { type: "response"; response: ScanResponse }
  /** A non-2xx reply; `status` 0 means the request never got an answer. */
  | { type: "failure"; status: number; error?: string; households?: ScanTable[] }
  /** Nothing was sent: the frame could not be captured. */
  | { type: "captureFailed"; message: string }
  /** The buyer picked one of the "Is it one of these?" options. */
  | { type: "choose"; item: SaleItem }
  | { type: "reset" };

export const initialScanView: ScanView = { kind: "idle" };

/** A plain sentence for a failed scan. */
export function scanErrorMessage(status: number, error?: string): string {
  if (status === 0) return "No connection. Check your signal and try again.";
  if (status === 401) return "Sign in to scan, then try again.";
  if (status === 429) return "Scanning a little too fast. Wait a moment, then try again.";
  if (status === 413) return "That photo is too big to send. Try again from a little closer.";
  if (status === 422) return "We could not match that photo. Try another angle.";
  if (status === 404 && error === "table_not_found") return "That table has nothing listed right now. Pick another table.";
  if (status === 404) return "This sale is not available any more.";
  if (status === 400) return "That photo did not work. Try again.";
  return "Scanning is not working right now. Try again in a moment, or browse the list.";
}

/** The settled result for a /api/scan reply. */
export function resultFromResponse(response: ScanResponse): ScanResult {
  if (response.match) {
    const { item, confidence, box } = response.match;
    if (confidence === "low") {
      const options = [item, ...response.alternatives.filter((other) => other.id !== item.id)];
      return options.length > 1 ? { kind: "choose", options } : { kind: "match", item, confidence, box };
    }
    return { kind: "match", item, confidence, box };
  }
  if (response.notListed) return { kind: "notListed", ...response.notListed };
  if (response.alternatives.length > 0) return { kind: "choose", options: response.alternatives };
  return { kind: "nothing" };
}

function settled(view: ScanView): ScanResult | null {
  if (view.kind === "idle") return null;
  if (view.kind === "scanning") return view.previous;
  return view;
}

export function scanViewReducer(view: ScanView, action: ScanAction): ScanView {
  switch (action.type) {
    case "start":
      return { kind: "scanning", previous: settled(view) };
    case "response":
      return resultFromResponse(action.response);
    case "failure":
      if (action.status === 400 && action.error === "pick_a_table" && action.households) {
        return { kind: "pickTable", tables: action.households };
      }
      return { kind: "error", message: scanErrorMessage(action.status, action.error), signIn: action.status === 401 };
    case "captureFailed":
      return { kind: "error", message: action.message, signIn: false };
    case "choose":
      // A buyer's pick is not a guess any more, but there is no box to point at.
      return { kind: "match", item: action.item, confidence: "medium", box: null };
    case "reset":
      return initialScanView;
  }
}

/** True when the card should point at the item rather than sit at the bottom. */
export function pointsAtItem(view: ScanView): view is Extract<ScanResult, { kind: "match" }> & { box: ScanBox } {
  return view.kind === "match" && view.box !== null && view.confidence !== "low";
}
