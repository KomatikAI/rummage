import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "./types";

// The default clients need Next request cookies / real env; tests pass a fake client.
vi.mock("./server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("./admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { createSupabaseAdminClient } from "./admin";
import {
  getMyCart,
  getMyHousehold,
  getMyPickups,
  getPublicListings,
  recordPayPalEvent,
  SupabaseQueryError,
} from "./queries";
import { createSupabaseServerClient } from "./server";

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: { code?: string; message: string } | null };

/** A chainable stand-in for the PostgREST builder that records every call. */
function fakeClient(result: Result, userId: string | null = "user-1") {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "upsert", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);

  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
    rpc: (fn: string, args?: unknown) => {
      calls.push({ method: "rpc", args: args === undefined ? [fn] : [fn, args] });
      return Promise.resolve(result);
    },
    auth: {
      getClaims: () =>
        Promise.resolve(
          userId ? { data: { claims: { sub: userId } }, error: null } : { data: null, error: null },
        ),
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

const methods = (calls: Call[]) => calls.map((c) => c.method);

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReset();
});

describe("getPublicListings", () => {
  it("reads the public view filtered by sale slug", async () => {
    const row = { item_id: "i1", sale_slug: "maple" };
    const { client, calls } = fakeClient({ data: [row], error: null });

    await expect(getPublicListings("maple", client)).resolves.toEqual([row]);
    expect(calls[0]).toEqual({ method: "from", args: ["public_listings"] });
    expect(calls).toContainEqual({ method: "eq", args: ["sale_slug", "maple"] });
    expect(methods(calls)).not.toContain("upsert");
  });

  it("uses the cookie client by default", async () => {
    const { client } = fakeClient({ data: [], error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);

    await expect(getPublicListings("maple")).resolves.toEqual([]);
    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
  });

  it("throws a SupabaseQueryError on error", async () => {
    const { client } = fakeClient({ data: null, error: { code: "42501", message: "denied" } });
    await expect(getPublicListings("maple", client)).rejects.toBeInstanceOf(SupabaseQueryError);
  });
});

describe("getMyHousehold", () => {
  it("filters by sale and the signed-in owner", async () => {
    const { client, calls } = fakeClient({ data: { id: "h1" }, error: null }, "seller-9");

    await expect(getMyHousehold("sale-1", client)).resolves.toEqual({ id: "h1" });
    expect(calls[0]).toEqual({ method: "from", args: ["households"] });
    expect(calls).toContainEqual({ method: "eq", args: ["sale_id", "sale-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["owner_user_id", "seller-9"] });
    expect(methods(calls)).toContain("maybeSingle");
  });

  it("returns null without querying when signed out", async () => {
    const { client, calls } = fakeClient({ data: { id: "h1" }, error: null }, null);
    await expect(getMyHousehold("sale-1", client)).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("getMyCart", () => {
  it("loads the live cart with its lines for the signed-in buyer", async () => {
    const cart = { id: "c1", cart_lines: [] };
    const { client, calls } = fakeClient({ data: cart, error: null }, "buyer-2");

    await expect(getMyCart("sale-1", client)).resolves.toEqual(cart);
    expect(calls[0]).toEqual({ method: "from", args: ["carts"] });
    expect(calls).toContainEqual({ method: "select", args: ["*, cart_lines(*)"] });
    expect(calls).toContainEqual({ method: "eq", args: ["sale_id", "sale-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["buyer_user_id", "buyer-2"] });
    expect(calls).toContainEqual({ method: "in", args: ["status", ["open", "checkout"]] });
  });
});

describe("getMyPickups", () => {
  it("calls the get_my_pickups RPC with no arguments", async () => {
    const { client, calls } = fakeClient({ data: [{ pickup_code: "ABC234" }], error: null });
    await expect(getMyPickups(client)).resolves.toEqual([{ pickup_code: "ABC234" }]);
    expect(calls).toEqual([{ method: "rpc", args: ["get_my_pickups"] }]);
  });
});

describe("recordPayPalEvent", () => {
  const event = {
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource: { id: "CAP-1", status: "COMPLETED" },
  };

  it("upserts with ignoreDuplicates and returns true for a new event", async () => {
    const { client, calls } = fakeClient({ data: [{ event_id: "WH-1" }], error: null });

    await expect(recordPayPalEvent(event, client)).resolves.toBe(true);
    expect(calls[0]).toEqual({ method: "from", args: ["paypal_events"] });
    const upsert = calls.find((c) => c.method === "upsert");
    expect(upsert?.args).toEqual([
      {
        event_id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource_type: "capture",
        resource_id: "CAP-1",
        payload: event,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    ]);
  });

  it("returns false for a duplicate event_id", async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(recordPayPalEvent(event, client)).resolves.toBe(false);
  });

  it("uses the service-role client by default", async () => {
    const { client } = fakeClient({ data: [{ event_id: "WH-1" }], error: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await expect(recordPayPalEvent(event)).resolves.toBe(true);
    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects an event without an id", async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(recordPayPalEvent({ ...event, id: "" }, client)).rejects.toThrow(/event id/);
  });
});
