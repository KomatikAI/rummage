import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase, itemId, listing, SALE_ID, type FakeRow } from "@/lib/repos/test-utils";

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://db.rummage.test" } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/ai/scan-match", async () => {
  class ScanMatchError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { matchFrameToListings: vi.fn(), ScanMatchError, SCAN_MAX_CANDIDATES: 24 };
});

import { matchFrameToListings, ScanMatchError, type ScanMatchResult } from "@/lib/ai/scan-match";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { scanRateLimiter } from "./rate-limit";
import { POST } from "./route";

const SLUG = "forest-park";
const TABLE_A = "b0000000-0000-4000-8000-000000000001";
const TABLE_B = "b0000000-0000-4000-8000-000000000002";
const frame = Buffer.from("fake jpeg bytes").toString("base64");

let db: FakeSupabase;

function setup(rows: FakeRow[], userId: string | null = "buyer-1") {
  db = new FakeSupabase({
    userId,
    tables: { public_sales: [{ id: SALE_ID, slug: SLUG, name: "Forest Park sale" }], public_listings: rows },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(db.client);
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const body = { saleSlug: SLUG, frameBase64: frame, mediaType: "image/jpeg" };
const NOTHING: ScanMatchResult = { match: null, alternatives: [], notListed: null };

function candidateIds(): string[] {
  const call = vi.mocked(matchFrameToListings).mock.calls.at(-1);
  return call ? call[0].candidates.map((candidate) => candidate.id) : [];
}

beforeEach(() => {
  scanRateLimiter.reset();
  vi.mocked(matchFrameToListings).mockReset();
  vi.mocked(matchFrameToListings).mockResolvedValue(NOTHING);
  setup([listing(1), listing(2, { status: "held" }), listing(3, { status: "sold" })]);
});

describe("POST /api/scan", () => {
  it("401s when signed out", async () => {
    setup([listing(1)], null);
    const res = await post(body);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "sign_in_required" });
    expect(matchFrameToListings).not.toHaveBeenCalled();
  });

  it("rejects bad bodies, bad base64 and other media types", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ ...body, saleSlug: "" })).status).toBe(400);
    expect((await post({ ...body, mediaType: "image/gif" })).status).toBe(400);
    expect((await post({ ...body, frameBase64: "not base64!" })).status).toBe(400);
    expect((await post({ ...body, frameBase64: `data:image/png;base64,${frame}` })).status).toBe(400);
    expect(matchFrameToListings).not.toHaveBeenCalled();
  });

  it("accepts a matching data URL prefix and strips it", async () => {
    expect((await post({ ...body, frameBase64: `data:image/jpeg;base64,${frame}` })).status).toBe(200);
    expect(vi.mocked(matchFrameToListings).mock.calls[0]?.[0].frameBase64).toBe(frame);
  });

  it("413s a frame over 1.5 MB decoded", async () => {
    const big = Buffer.alloc(1.5 * 1024 * 1024 + 3).toString("base64");
    const res = await post({ ...body, frameBase64: big });
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: "image_too_large" });
  });

  it("matches against listed and held items, never sold ones", async () => {
    vi.mocked(matchFrameToListings).mockResolvedValue({
      match: { itemId: itemId(2), confidence: "high", box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
      alternatives: [itemId(1)],
      notListed: null,
    });
    const res = await post(body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(candidateIds()).toEqual([itemId(1), itemId(2)]);
    expect(json.match).toMatchObject({
      confidence: "high",
      box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
      item: { id: itemId(2), status: "held", title: "Item 2", price: 5, householdLabel: "The Alvarez table" },
    });
    expect(json.alternatives.map((item: { id: string }) => item.id)).toEqual([itemId(1)]);
    expect(json.notListed).toBeNull();
  });

  it("sends condition labels and public photo URLs to the matcher", async () => {
    setup([listing(1, { condition: "poor", photo_path: "sale/one.jpg" })]);
    await post(body);
    const candidate = vi.mocked(matchFrameToListings).mock.calls[0]?.[0].candidates[0];
    expect(candidate).toMatchObject({
      condition: "Well used",
      photoUrl: "https://db.rummage.test/storage/v1/object/public/item-photos/sale/one.jpg",
      status: "available",
    });
  });

  it("passes the estimate through when nothing matched", async () => {
    vi.mocked(matchFrameToListings).mockResolvedValue({
      match: null,
      alternatives: [],
      notListed: { title: "Desk fan", priceLow: 5, priceHigh: 10 },
    });
    const json = await (await post(body)).json();
    expect(json).toEqual({ match: null, alternatives: [], notListed: { title: "Desk fan", priceLow: 5, priceHigh: 10 } });
  });

  it("filters to one table when householdId is given", async () => {
    setup([listing(1), listing(2, { household_id: TABLE_B, household_label: "Blue tarp" })]);
    expect((await post({ ...body, householdId: TABLE_B })).status).toBe(200);
    expect(candidateIds()).toEqual([itemId(2)]);
  });

  it("404s an unknown table and an unknown sale", async () => {
    expect((await post({ ...body, householdId: "b0000000-0000-4000-8000-000000000099" })).status).toBe(404);
    scanRateLimiter.reset();
    const res = await post({ ...body, saleSlug: "nowhere" });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "sale_not_found" });
  });

  it("asks the buyer to pick a table when the sale has more than 24 scannable items", async () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => listing(i + 1)),
      ...Array.from({ length: 6 }, (_, i) => listing(i + 21, { household_id: TABLE_B, household_label: "Blue tarp" })),
      listing(40, { status: "sold" }),
    ];
    setup(rows);
    const res = await post(body);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "pick_a_table",
      // In the query order: by table label.
      households: [
        { householdId: TABLE_B, label: "Blue tarp", count: 6 },
        { householdId: TABLE_A, label: "The Alvarez table", count: 20 },
      ],
    });
    expect(matchFrameToListings).not.toHaveBeenCalled();
  });

  it("caps one very full table at 24 candidates, still-for-sale items first", async () => {
    setup([listing(1, { status: "held" }), ...Array.from({ length: 30 }, (_, i) => listing(i + 2))]);
    await post({ ...body, householdId: TABLE_A });
    const ids = candidateIds();
    expect(ids).toHaveLength(24);
    expect(ids).not.toContain(itemId(1));
  });

  it("502s when the listings do not load", async () => {
    db.failNext("public_listings", "select", { message: "boom" });
    const res = await post(body);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "listings_failed" });
  });

  it("maps a refusal to 422 and other scan errors to 502", async () => {
    vi.mocked(matchFrameToListings).mockRejectedValueOnce(new ScanMatchError("refusal", "no"));
    const refused = await post(body);
    expect(refused.status).toBe(422);
    await expect(refused.json()).resolves.toEqual({ error: "scan_refused" });

    scanRateLimiter.reset();
    vi.mocked(matchFrameToListings).mockRejectedValueOnce(new ScanMatchError("invalid_json", "bad"));
    const failed = await post(body);
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: "scan_failed", code: "invalid_json" });
  });

  it("500s an unexpected error without logging the frame", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(matchFrameToListings).mockRejectedValueOnce(new Error("socket hang up"));
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(frame);
    spy.mockRestore();
  });

  it("429s a second scan inside 1.2 s", async () => {
    expect((await post(body)).status).toBe(200);
    const res = await post(body);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: "slow_down" });
    expect(matchFrameToListings).toHaveBeenCalledTimes(1);
  });
});
