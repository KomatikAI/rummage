import { describe, expect, it } from "vitest";

import { ensureLiveCart } from "./carts";
import { BUYER_ID, CART_ID, FakeSupabase, SALE_ID } from "./test-utils";

describe("ensureLiveCart", () => {
  it("returns the buyer's existing open cart", async () => {
    const fake = new FakeSupabase({
      userId: BUYER_ID,
      tables: {
        carts: [
          { id: "old", buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "paid", created_at: "1" },
          { id: CART_ID, buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "open", created_at: "2" },
        ],
      },
    });
    await expect(ensureLiveCart(fake.client, SALE_ID, BUYER_ID)).resolves.toEqual({
      status: "open",
      cartId: CART_ID,
    });
    expect(fake.calls.some((c) => c.kind === "insert")).toBe(false);
  });

  it("reports a cart that is at checkout", async () => {
    const fake = new FakeSupabase({
      tables: {
        carts: [{ id: CART_ID, buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "checkout" }],
      },
    });
    await expect(ensureLiveCart(fake.client, SALE_ID, BUYER_ID)).resolves.toEqual({
      status: "checkout",
      cartId: CART_ID,
    });
  });

  it("creates an open cart with sale_id and buyer_user_id when there is none", async () => {
    const fake = new FakeSupabase({ tables: { carts: [] } });
    fake.insertDefaults.carts = () => ({ id: CART_ID, status: "open" });
    await expect(ensureLiveCart(fake.client, SALE_ID, BUYER_ID)).resolves.toEqual({
      status: "open",
      cartId: CART_ID,
    });
    expect(fake.tables.carts[0]).toMatchObject({ sale_id: SALE_ID, buyer_user_id: BUYER_ID });
  });

  it("re-reads after losing an insert race (23505)", async () => {
    const raced = new FakeSupabase({ tables: { carts: [] } });
    raced.failNext("carts", "insert", { code: "23505", message: "duplicate key" });
    const originalInsertFailure = raced.takeFailure.bind(raced);
    raced.takeFailure = (table, op) => {
      const failure = originalInsertFailure(table, op);
      if (failure && op === "insert") {
        raced.tables.carts.push({ id: CART_ID, buyer_user_id: BUYER_ID, sale_id: SALE_ID, status: "open" });
      }
      return failure;
    };
    await expect(ensureLiveCart(raced.client, SALE_ID, BUYER_ID)).resolves.toEqual({
      status: "open",
      cartId: CART_ID,
    });
  });

  it("maps an RLS refusal (sale not open) to cart_not_allowed", async () => {
    const fake = new FakeSupabase({ tables: { carts: [] } });
    fake.failNext("carts", "insert", { code: "42501", message: "new row violates row-level security policy" });
    await expect(ensureLiveCart(fake.client, SALE_ID, BUYER_ID)).rejects.toMatchObject({
      code: "cart_not_allowed",
    });
  });
});
