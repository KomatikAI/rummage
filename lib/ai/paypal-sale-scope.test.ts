import type { Tool } from "ai";
import { describe, expect, it, vi } from "vitest";

import { NOT_THIS_SALE, scopePayPalToolsToSale } from "./paypal-sale-scope";

const options = { toolCallId: "call-1", messages: [] } as unknown as Parameters<NonNullable<Tool["execute"]>>[1];

function fakeTool(result: unknown) {
  return { description: "d", inputSchema: {}, execute: vi.fn(async () => result) } as unknown as Tool;
}

const sale = { orderIds: new Set(["ORDER-1"]), refundIds: new Set(["REF-1"]) };

describe("scopePayPalToolsToSale", () => {
  it("drops list_transactions and anything it does not know", () => {
    const scoped = scopePayPalToolsToSale(
      { list_transactions: fakeTool(1), get_order: fakeTool(2), get_refund: fakeTool(3), pay_order: fakeTool(4) },
      sale,
    );
    expect(Object.keys(scoped).sort()).toEqual(["get_order", "get_refund"]);
  });

  it("passes the sale's own order and refund ids through", async () => {
    const order = fakeTool({ id: "ORDER-1" });
    const refund = fakeTool({ id: "REF-1" });
    const scoped = scopePayPalToolsToSale({ get_order: order, get_refund: refund }, sale);
    await expect(scoped.get_order.execute!({ id: "ORDER-1" }, options)).resolves.toEqual({ id: "ORDER-1" });
    await expect(scoped.get_refund.execute!({ refund_id: "REF-1" }, options)).resolves.toEqual({ id: "REF-1" });
    expect(order.execute).toHaveBeenCalledWith({ id: "ORDER-1" }, options);
  });

  it("answers not_this_sale for another sale's id without calling PayPal", async () => {
    const order = fakeTool({ id: "ORDER-9" });
    const refund = fakeTool({ id: "REF-9" });
    const scoped = scopePayPalToolsToSale({ get_order: order, get_refund: refund }, sale);
    await expect(scoped.get_order.execute!({ id: "ORDER-9" }, options)).resolves.toEqual(NOT_THIS_SALE);
    await expect(scoped.get_refund.execute!({ refund_id: "REF-9" }, options)).resolves.toEqual(NOT_THIS_SALE);
    await expect(scoped.get_order.execute!({}, options)).resolves.toEqual(NOT_THIS_SALE);
    expect(order.execute).not.toHaveBeenCalled();
    expect(refund.execute).not.toHaveBeenCalled();
  });
});
