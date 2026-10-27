import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, fakeSessionClient, ok, type FakeQuery } from "@/lib/checkout/test-db";
import type { Database } from "@/lib/supabase/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/ai/screen-listing", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  screenListing: vi.fn(),
}));

import { screenListing, SCREEN_UNCHECKED_REASON } from "@/lib/ai/screen-listing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createItem } from "./actions";

const SELLER = "seller-1";
const HOUSEHOLD = "b0000000-0000-4000-8000-000000000001";
const PHOTO = `households/${HOUSEHOLD}/d0000000-0000-4000-8000-000000000001.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const input = {
  householdId: HOUSEHOLD,
  photoPath: PHOTO,
  title: "Car seat",
  description: "Used, no box.",
  category: "kids",
  condition: "good",
  price: "10",
  priceLow: null,
  priceHigh: null,
  priceReason: null,
} as const;

type Options = { userId?: string | null; ownsHousehold?: boolean; photo?: Blob | null };

function setup(options: Options = {}) {
  const user = fakeDb((q: FakeQuery) => {
    if (q.table === "households") return ok(options.ownsHousehold === false ? null : { id: HOUSEHOLD });
    if (q.table === "items" && q.action === "insert") return ok({ id: "item-listed" });
    return undefined;
  });
  const admin = fakeDb((q: FakeQuery) => {
    if (q.table === "items" && q.action === "insert") return ok({ id: "item-flagged" });
    return undefined;
  });
  const downloads: string[] = [];
  const photo = options.photo === undefined ? new Blob([JPEG]) : options.photo;
  const storage = {
    from: (bucket: string) => ({
      download: async (path: string) => {
        downloads.push(`${bucket}/${path}`);
        return photo ? { data: photo, error: null } : { data: null, error: { message: "not found" } };
      },
    }),
  };
  const session = fakeSessionClient(options.userId === undefined ? SELLER : options.userId);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    ...(user.client as object),
    auth: session.auth,
  } as unknown as SupabaseClient<Database>);
  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    ...(admin.client as object),
    storage,
  } as unknown as SupabaseClient<Database>);
  return { user, admin, downloads };
}

const inserts = (db: { queries: FakeQuery[] }) =>
  db.queries.filter((q) => q.table === "items" && q.action === "insert").map((q) => q.payload);

beforeEach(() => {
  vi.mocked(screenListing).mockReset();
});

describe("createItem prohibited-item screen", () => {
  it("lists an allowed item with the seller's own client after screening the stored photo", async () => {
    const { user, admin, downloads } = setup();
    vi.mocked(screenListing).mockResolvedValue({ prohibited: false, reason: null, checked: true });
    await expect(createItem(input)).resolves.toEqual({ ok: true, itemId: "item-listed" });
    expect(downloads).toEqual([`item-photos/${PHOTO}`]);
    expect(screenListing).toHaveBeenCalledWith({
      title: "Car seat",
      description: "Used, no box.",
      category: "kids",
      imageBase64: Buffer.from(JPEG).toString("base64"),
      mediaType: "image/jpeg",
    });
    expect(inserts(user)).toEqual([expect.objectContaining({ status: "listed", photo_path: PHOTO })]);
    expect(inserts(user)[0]).not.toHaveProperty("prohibited_flag");
    expect(inserts(admin)).toEqual([]);
  });

  it("stores a flagged item as a draft with the service role and returns the reason", async () => {
    const { user, admin } = setup();
    const reason = "A used car seat with no crash history cannot be sold here.";
    vi.mocked(screenListing).mockResolvedValue({ prohibited: true, reason, checked: true });
    const result = await createItem(input);
    expect(result).toEqual({
      ok: false,
      error: `This item cannot be listed at this sale. ${reason} We kept it as a draft that buyers cannot see.`,
    });
    expect(inserts(admin)).toEqual([
      expect.objectContaining({
        household_id: HOUSEHOLD,
        status: "draft",
        prohibited_flag: true,
        prohibited_reason: reason,
      }),
    ]);
    expect(inserts(user)).toEqual([]);
  });

  it("lists nothing when the screen could not run", async () => {
    const { user, admin } = setup();
    vi.mocked(screenListing).mockResolvedValue({ prohibited: true, reason: SCREEN_UNCHECKED_REASON, checked: false });
    const result = await createItem(input);
    expect(result.ok).toBe(false);
    expect(inserts(user)).toEqual([]);
    expect(inserts(admin)).toEqual([]);
  });

  it("refuses a photo it cannot read or recognise, without screening", async () => {
    for (const photo of [null, new Blob([new TextEncoder().encode("not an image")])]) {
      const { user } = setup({ photo });
      const result = await createItem(input);
      expect(result.ok).toBe(false);
      expect(inserts(user)).toEqual([]);
    }
    expect(screenListing).not.toHaveBeenCalled();
  });

  it("checks household ownership before any service-role read or write", async () => {
    const { downloads, admin } = setup({ ownsHousehold: false });
    const result = await createItem(input);
    expect(result).toMatchObject({ ok: false });
    expect(downloads).toEqual([]);
    expect(admin.queries).toEqual([]);
    expect(screenListing).not.toHaveBeenCalled();
  });

  it("asks a signed-out seller to sign in again", async () => {
    setup({ userId: null });
    await expect(createItem(input)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("Sign in") });
    expect(screenListing).not.toHaveBeenCalled();
  });
});
