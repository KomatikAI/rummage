import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUYER_ID,
  CART_ID,
  FakeSupabase,
  SALE_ID,
  type FakeRow,
} from "@/lib/repos/test-utils";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/ai/shopping-assistant", () => ({ runShoppingAssistant: vi.fn() }));

import { runShoppingAssistant } from "@/lib/ai/shopping-assistant";
import { SupabaseItemsRepo } from "@/lib/repos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const uiMessages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Any lamps under $10?" }] },
];

let fake: FakeSupabase;

function useFake(tables: Record<string, FakeRow[]>, userId: string | null = BUYER_ID) {
  fake = new FakeSupabase({ userId, tables });
  fake.insertDefaults.carts = () => ({ id: CART_ID, status: "open" });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.client);
}

const openSale = { id: SALE_ID, name: "Forest Park PTA sale", status: "open" };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/assistant/shop", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.mocked(runShoppingAssistant).mockReset();
  vi.mocked(runShoppingAssistant).mockReturnValue({
    result: { toUIMessageStreamResponse: () => new Response("ui-stream", { status: 200 }) },
    toolCalls: Promise.resolve([]),
  } as unknown as ReturnType<typeof runShoppingAssistant>);
  useFake({ public_sales: [openSale], carts: [] });
});

describe("POST /api/assistant/shop", () => {
  it("401s when signed out, before reading the body", async () => {
    useFake({ public_sales: [openSale] }, null);
    const res = await post("not json");
    expect(res.status).toBe(401);
    expect(runShoppingAssistant).not.toHaveBeenCalled();
  });

  it("400s on bad JSON, a bad sale id or empty messages", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post({ saleId: "nope", messages: uiMessages })).status).toBe(400);
    expect((await post({ saleId: SALE_ID, messages: [] })).status).toBe(400);
  });

  it("400s on messages that are not UI messages", async () => {
    const res = await post({ saleId: SALE_ID, messages: [{ role: "user", content: 3 }] });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_messages" });
  });

  it("413s an oversized body", async () => {
    const res = await post({ saleId: SALE_ID, messages: uiMessages }, { "content-length": "9999999" });
    expect(res.status).toBe(413);
  });

  it("404s an unknown sale and 409s a sale that is not open", async () => {
    useFake({ public_sales: [] });
    expect((await post({ saleId: SALE_ID, messages: uiMessages })).status).toBe(404);
    useFake({ public_sales: [{ ...openSale, status: "closed" }] });
    expect((await post({ saleId: SALE_ID, messages: uiMessages })).status).toBe(409);
  });

  it("409s when the buyer's cart is at checkout", async () => {
    useFake({
      public_sales: [openSale],
      carts: [{ id: CART_ID, buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "checkout" }],
    });
    const res = await post({ saleId: SALE_ID, messages: uiMessages });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "cart_in_checkout" });
  });

  it("creates an open cart and streams the assistant bound to it", async () => {
    const res = await post({ saleId: SALE_ID, messages: uiMessages });
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("ui-stream");

    expect(fake.tables.carts).toEqual([
      expect.objectContaining({ id: CART_ID, sale_id: SALE_ID, buyer_user_id: BUYER_ID }),
    ]);
    const input = vi.mocked(runShoppingAssistant).mock.calls[0][0];
    expect(input.cartId).toBe(CART_ID);
    expect(input.saleName).toBe("Forest Park PTA sale");
    expect(input.repo).toBeInstanceOf(SupabaseItemsRepo);
    expect(input.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Any lamps under $10?" }] },
    ]);
  });

  it("reuses the buyer's open cart", async () => {
    useFake({
      public_sales: [openSale],
      carts: [{ id: "existing", buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "open" }],
    });
    await post({ saleId: SALE_ID, messages: uiMessages });
    expect(vi.mocked(runShoppingAssistant).mock.calls[0][0].cartId).toBe("existing");
    expect(fake.calls.some((c) => c.kind === "insert")).toBe(false);
  });

  it("500s without detail when a lookup fails", async () => {
    fake.failNext("carts", "select", { message: "connection reset" });
    const res = await post({ saleId: SALE_ID, messages: uiMessages });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "assistant_failed" });
  });
});
