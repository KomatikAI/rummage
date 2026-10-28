import { describe, expect, it } from "vitest";

import type { SaleItem } from "@/components/buyer/listings";
import { SCAN_MAX_CANDIDATES } from "@/lib/ai/scan-match";

import {
  AUTO_IDLE_MS,
  AUTO_INTERVAL_MS,
  AUTO_MAX_SCANS,
  autoScanReducer,
  autoScanTick,
  autoStopMessage,
  initialAutoScan,
  type AutoScanState,
} from "./auto-scan";
import { stripDataUrlPrefix } from "./capture-frame";
import { boxToScreen, coverRect, frameSize, MAX_FRAME_SIDE, placeSticker, STICKER_GAP, STICKER_GUTTER } from "./frame-math";
import { canScanWholeSale, initialTable, tableChoices, WHOLE_SALE_MAX_ITEMS } from "./scan-tables";
import { pointsAtItem, resultFromResponse, scanErrorMessage, scanViewReducer, initialScanView } from "./scan-view";

function item(n: number, overrides: Partial<SaleItem> = {}): SaleItem {
  return {
    id: `item-${n}`,
    title: `Item ${n}`,
    description: null,
    category: "other",
    condition: "good",
    price: 5,
    status: "available",
    acceptsPayments: true,
    householdId: "table-a",
    householdLabel: "Green awning",
    lng: null,
    lat: null,
    photoUrl: null,
    ...overrides,
  };
}

describe("frameSize", () => {
  it("scales the long side down to 768 and never up", () => {
    expect(MAX_FRAME_SIDE).toBe(768);
    expect(frameSize(1280, 720)).toEqual({ width: 768, height: 432 });
    expect(frameSize(720, 1280)).toEqual({ width: 432, height: 768 });
    expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe("coverRect and boxToScreen", () => {
  it("crops the sides of a wide frame in a tall view", () => {
    // 1280x720 frame in a 360x640 view: scale 640/720, drawn 1137.8 wide, centred.
    const rect = coverRect({ width: 1280, height: 720 }, { width: 360, height: 640 });
    expect(rect.height).toBeCloseTo(640);
    expect(rect.width).toBeCloseTo(1137.78, 1);
    expect(rect.left).toBeCloseTo(-388.89, 1);
    expect(rect.top).toBeCloseTo(0);
  });

  it("maps the frame centre to the view centre", () => {
    const view = { width: 360, height: 640 };
    const box = boxToScreen({ x: 0.45, y: 0.4, w: 0.1, h: 0.2 }, { width: 1280, height: 720 }, view);
    expect(box.left + box.width / 2).toBeCloseTo(180);
    expect(box.top + box.height / 2).toBeCloseTo(320);
  });

  it("is the identity when frame and view have the same shape", () => {
    expect(boxToScreen({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { width: 400, height: 200 }, { width: 800, height: 400 })).toEqual({
      left: 80,
      top: 80,
      width: 400,
      height: 100,
    });
  });
});

describe("placeSticker", () => {
  const view = { width: 360, height: 640 };
  const card = { width: 240, height: 120 };

  it("sits bottom-centre with no target", () => {
    expect(placeSticker(null, card, view)).toEqual({ left: 60, top: 640 - STICKER_GUTTER - 120 });
  });

  it("goes under the item, centred on it", () => {
    const target = { left: 130, top: 100, width: 100, height: 100 };
    expect(placeSticker(target, card, view)).toEqual({ left: 60, top: 200 + STICKER_GAP });
  });

  it("goes above the item when there is no room below", () => {
    const target = { left: 130, top: 450, width: 100, height: 120 };
    expect(placeSticker(target, card, view)).toEqual({ left: 60, top: 450 - STICKER_GAP - 120 });
  });

  it("clamps inside the view with a 16 px gutter", () => {
    const left = placeSticker({ left: -50, top: 10, width: 60, height: 40 }, card, view);
    expect(left.left).toBe(STICKER_GUTTER);
    const right = placeSticker({ left: 340, top: 10, width: 60, height: 40 }, card, view);
    expect(right.left).toBe(360 - STICKER_GUTTER - 240);
  });

  it("overlaps the item's centre when it fills the view, still inside the gutter", () => {
    const placed = placeSticker({ left: 0, top: 0, width: 360, height: 640 }, card, view);
    expect(placed).toEqual({ left: 60, top: 260 });
  });

  it("pins to the gutter when the card is wider than the room", () => {
    expect(placeSticker(null, { width: 400, height: 120 }, view).left).toBe(STICKER_GUTTER);
  });
});

describe("auto-scan", () => {
  function liveOn(now = 0): AutoScanState {
    let state = initialAutoScan(now);
    state = autoScanReducer(state, { type: "live", live: true });
    return autoScanReducer(state, { type: "toggle", now });
  }

  it("does nothing while off", () => {
    const state = autoScanReducer(initialAutoScan(0), { type: "live", live: true });
    expect(autoScanTick(state, 10_000).fire).toBe(false);
  });

  it("fires at once, then every interval after the last scan finished", () => {
    let state = liveOn();
    let tick = autoScanTick(state, 0);
    expect(tick.fire).toBe(true);
    state = autoScanReducer(tick.state, { type: "start", now: 0 });
    expect(autoScanTick(state, 5000).fire).toBe(false); // in flight
    state = autoScanReducer(state, { type: "finish", now: 1000 });
    expect(autoScanTick(state, 1000 + AUTO_INTERVAL_MS - 1).fire).toBe(false);
    tick = autoScanTick(state, 1000 + AUTO_INTERVAL_MS);
    expect(tick.fire).toBe(true);
    expect(tick.state.scansSinceTap).toBe(2);
  });

  it("waits while hidden or not live", () => {
    let state = autoScanReducer(liveOn(), { type: "visibility", visible: false });
    expect(autoScanTick(state, 0).fire).toBe(false);
    state = autoScanReducer(state, { type: "visibility", visible: true });
    expect(autoScanTick(state, 0).fire).toBe(true);
    state = autoScanReducer(state, { type: "live", live: false });
    expect(state.on).toBe(false);
  });

  it(`stops after ${AUTO_MAX_SCANS} scans without a tap, and a tap resets the count`, () => {
    let state: AutoScanState = { ...liveOn(), scansSinceTap: AUTO_MAX_SCANS - 1 };
    const last = autoScanTick(state, 0);
    expect(last.fire).toBe(true);
    state = autoScanReducer(autoScanReducer(last.state, { type: "start", now: 0 }), { type: "finish", now: 0 });
    const tapped = autoScanReducer(state, { type: "tap", now: 1 });
    expect(autoScanTick(tapped, AUTO_INTERVAL_MS).fire).toBe(true);
    const stopped = autoScanTick(state, AUTO_INTERVAL_MS);
    expect(stopped).toMatchObject({ fire: false, state: { on: false, stopped: "limit" } });
    expect(autoStopMessage(stopped.state.stopped)).toContain("20 scans");
  });

  it("stops after two minutes without a tap", () => {
    const stopped = autoScanTick(liveOn(0), AUTO_IDLE_MS);
    expect(stopped).toMatchObject({ fire: false, state: { on: false, stopped: "idle" } });
    expect(autoStopMessage(null)).toBeNull();
  });

  it("clears the stop reason when toggled again", () => {
    const stopped = autoScanTick(liveOn(0), AUTO_IDLE_MS).state;
    const again = autoScanReducer(stopped, { type: "toggle", now: AUTO_IDLE_MS + 1 });
    expect(again).toMatchObject({ on: true, stopped: null, scansSinceTap: 0 });
    expect(autoScanTick(again, AUTO_IDLE_MS + 1).fire).toBe(true);
  });
});

describe("scan view", () => {
  const a = item(1);
  const b = item(2, { status: "held" });

  it("fades the previous card while a new scan is in flight", () => {
    const matched = scanViewReducer(initialScanView, {
      type: "response",
      response: { match: { item: a, confidence: "high", box: null }, alternatives: [], notListed: null },
    });
    expect(matched).toMatchObject({ kind: "match", item: a });
    expect(scanViewReducer(matched, { type: "start" })).toEqual({ kind: "scanning", previous: matched });
    expect(scanViewReducer(initialScanView, { type: "start" })).toEqual({ kind: "scanning", previous: null });
    const scanning = scanViewReducer(matched, { type: "start" });
    expect(scanViewReducer(scanning, { type: "start" })).toEqual({ kind: "scanning", previous: matched });
  });

  it("turns a low-confidence match into a choice, guess first", () => {
    expect(
      resultFromResponse({ match: { item: a, confidence: "low", box: null }, alternatives: [b, a], notListed: null }),
    ).toEqual({ kind: "choose", options: [a, b] });
    expect(resultFromResponse({ match: { item: a, confidence: "low", box: null }, alternatives: [], notListed: null })).toMatchObject({
      kind: "match",
    });
  });

  it("shows the estimate, or alternatives, or nothing", () => {
    expect(resultFromResponse({ match: null, alternatives: [], notListed: { title: "Fan", priceLow: 5, priceHigh: 10 } })).toEqual({
      kind: "notListed",
      title: "Fan",
      priceLow: 5,
      priceHigh: 10,
    });
    expect(resultFromResponse({ match: null, alternatives: [b], notListed: null })).toEqual({ kind: "choose", options: [b] });
    expect(resultFromResponse({ match: null, alternatives: [], notListed: null })).toEqual({ kind: "nothing" });
  });

  it("maps failures, including pick_a_table", () => {
    const tables = [{ householdId: "t", label: "T", count: 30 }];
    expect(scanViewReducer(initialScanView, { type: "failure", status: 400, error: "pick_a_table", households: tables })).toEqual({
      kind: "pickTable",
      tables,
    });
    expect(scanViewReducer(initialScanView, { type: "failure", status: 401 })).toMatchObject({ kind: "error", signIn: true });
    expect(scanViewReducer(initialScanView, { type: "failure", status: 502 })).toMatchObject({ kind: "error", signIn: false });
    expect(scanViewReducer(initialScanView, { type: "captureFailed", message: "The camera is still starting." })).toEqual({
      kind: "error",
      message: "The camera is still starting.",
      signIn: false,
    });
  });

  it("has a plain sentence for every failure", () => {
    for (const [status, error] of [[0], [401], [429], [413], [422], [404, "table_not_found"], [404], [400], [500], [502]] as const) {
      const message = scanErrorMessage(status, error);
      expect(message).toMatch(/\.$/);
      expect(message).not.toContain("!");
    }
  });

  it("makes a chosen option the match, pointing at nothing", () => {
    const chosen = scanViewReducer({ kind: "choose", options: [a, b] }, { type: "choose", item: b });
    expect(chosen).toEqual({ kind: "match", item: b, confidence: "medium", box: null });
    expect(pointsAtItem(chosen)).toBe(false);
    expect(scanViewReducer(chosen, { type: "reset" })).toEqual(initialScanView);
  });

  it("points at the item only for a confident match with a box", () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(pointsAtItem({ kind: "match", item: a, confidence: "high", box })).toBe(true);
    expect(pointsAtItem({ kind: "match", item: a, confidence: "low", box })).toBe(false);
    expect(pointsAtItem({ kind: "nothing" })).toBe(false);
  });
});

describe("scan tables", () => {
  it("mirrors the matcher's candidate cap", () => {
    expect(WHOLE_SALE_MAX_ITEMS).toBe(SCAN_MAX_CANDIDATES);
  });

  it("lists every table with something for sale, map position or not", () => {
    const items = [
      item(1),
      item(2, { status: "sold" }),
      item(3, { householdId: "table-b", householdLabel: "Blue tarp", lng: -90, lat: 38 }),
      item(4, { householdId: "table-c", householdLabel: "Porch", status: "sold" }),
      item(5, { status: "held" }),
    ];
    expect(tableChoices(items)).toEqual([
      { householdId: "table-a", label: "Green awning", count: 2 },
      { householdId: "table-b", label: "Blue tarp", count: 1 },
    ]);
  });

  it("offers the whole sale only up to 24 items", () => {
    expect(canScanWholeSale([{ householdId: "a", label: "A", count: 24 }])).toBe(true);
    expect(canScanWholeSale([{ householdId: "a", label: "A", count: 20 }, { householdId: "b", label: "B", count: 5 }])).toBe(false);
    expect(canScanWholeSale([])).toBe(false);
  });

  it("starts on the requested table, else the only one, else none", () => {
    const tables = [
      { householdId: "a", label: "A", count: 1 },
      { householdId: "b", label: "B", count: 1 },
    ];
    expect(initialTable(tables, "b")).toBe("b");
    expect(initialTable(tables, "zzz")).toBeNull();
    expect(initialTable(tables, null)).toBeNull();
    expect(initialTable(tables.slice(0, 1), null)).toBe("a");
  });
});

describe("stripDataUrlPrefix", () => {
  it("drops a data URL prefix and keeps plain base64", () => {
    expect(stripDataUrlPrefix("data:image/jpeg;base64,QUJD")).toBe("QUJD");
    expect(stripDataUrlPrefix("QUJD")).toBe("QUJD");
  });
});
