import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase } from "@/lib/repos/test-utils";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/ai/pricing", async () => {
  class PricingError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { priceFromPhoto: vi.fn(), PricingError };
});

import { priceFromPhoto, PricingError } from "@/lib/ai/pricing";
import { validDraft } from "@/lib/ai/test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const FIVE_MB = 5 * 1024 * 1024;
const smallPng = Buffer.from("fake png bytes").toString("base64");

function signedIn(userId: string | null = "seller-1") {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(new FakeSupabase({ userId }).client);
}

function postJson(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/pricing", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function postForm(form: FormData) {
  return POST(new Request("http://localhost/api/pricing", { method: "POST", body: form }));
}

type Draft = Awaited<ReturnType<typeof priceFromPhoto>>;

beforeEach(() => {
  vi.mocked(priceFromPhoto).mockReset();
  vi.mocked(priceFromPhoto).mockResolvedValue(validDraft as unknown as Draft);
  signedIn();
});

describe("POST /api/pricing", () => {
  it("401s when signed out", async () => {
    signedIn(null);
    expect((await postJson({ imageBase64: smallPng, mediaType: "image/png" })).status).toBe(401);
    expect(priceFromPhoto).not.toHaveBeenCalled();
  });

  it("returns the ListingDraft for a JSON body", async () => {
    const res = await postJson({
      imageBase64: smallPng,
      mediaType: "image/png",
      sellerHint: " barely used ",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(validDraft);
    expect(priceFromPhoto).toHaveBeenCalledWith({
      imageBase64: smallPng,
      mediaType: "image/png",
      sellerHint: "barely used",
    });
  });

  it("strips a matching data URL prefix and rejects a mismatched one", async () => {
    await postJson({ imageBase64: `data:image/png;base64,${smallPng}`, mediaType: "image/png" });
    expect(vi.mocked(priceFromPhoto).mock.calls[0][0].imageBase64).toBe(smallPng);
    const res = await postJson({ imageBase64: `data:image/gif;base64,${smallPng}`, mediaType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("400s on bad JSON, a missing image, an unsupported type or invalid base64", async () => {
    expect((await postJson("{")).status).toBe(400);
    expect((await postJson({ mediaType: "image/png" })).status).toBe(400);
    expect((await postJson({ imageBase64: smallPng, mediaType: "image/heic" })).status).toBe(400);
    const bad = await postJson({ imageBase64: "not*base64", mediaType: "image/png" });
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toEqual({ error: "invalid_base64" });
  });

  it("413s an image over 5 MB (JSON)", async () => {
    const big = Buffer.alloc(FIVE_MB + 3).toString("base64");
    const res = await postJson({ imageBase64: big, mediaType: "image/jpeg" });
    expect(res.status).toBe(413);
    const declared = await postJson({ imageBase64: smallPng, mediaType: "image/png" }, { "content-length": String(20 * FIVE_MB) });
    expect(declared.status).toBe(413);
    expect(priceFromPhoto).not.toHaveBeenCalled();
  });

  it("accepts an exactly-5 MB image", async () => {
    const atCap = Buffer.alloc(FIVE_MB).toString("base64");
    expect((await postJson({ imageBase64: atCap, mediaType: "image/jpeg" })).status).toBe(200);
  });

  it("accepts multipart uploads", async () => {
    const form = new FormData();
    form.set("image", new Blob([Buffer.from("fake png bytes")], { type: "image/png" }), "photo.png");
    form.set("saleContext", "school fundraiser");
    const res = await postForm(form);
    expect(res.status).toBe(200);
    expect(priceFromPhoto).toHaveBeenCalledWith({
      imageBase64: smallPng,
      mediaType: "image/png",
      saleContext: "school fundraiser",
    });
  });

  it("rejects multipart without an image, with a wrong type, or over 5 MB", async () => {
    expect((await postForm(new FormData())).status).toBe(400);

    const wrongType = new FormData();
    wrongType.set("image", new Blob(["x"], { type: "text/plain" }), "a.txt");
    expect((await postForm(wrongType)).status).toBe(415);

    const big = new FormData();
    big.set("image", new Blob([Buffer.alloc(FIVE_MB + 1)], { type: "image/jpeg" }), "big.jpg");
    expect((await postForm(big)).status).toBe(413);
  });

  it("maps PricingError: refusal -> 422, others -> 502; unknown errors -> 500", async () => {
    vi.mocked(priceFromPhoto).mockRejectedValueOnce(new PricingError("refusal", "declined"));
    expect((await postJson({ imageBase64: smallPng, mediaType: "image/png" })).status).toBe(422);

    vi.mocked(priceFromPhoto).mockRejectedValueOnce(new PricingError("invalid_json", "bad"));
    const failed = await postJson({ imageBase64: smallPng, mediaType: "image/png" });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: "pricing_failed", code: "invalid_json" });

    vi.mocked(priceFromPhoto).mockRejectedValueOnce(new Error("network"));
    expect((await postJson({ imageBase64: smallPng, mediaType: "image/png" })).status).toBe(500);
  });
});
