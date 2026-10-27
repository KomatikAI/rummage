import { describe, expect, it } from "vitest";

import { createMultiSellerOrderSchema } from "@/lib/paypal";

import {
  buildCheckoutUnits,
  DONATION_REFERENCE_ID,
  toCentsFromNumber,
  type CheckoutHousehold,
  type CheckoutLine,
} from "./order-units";

const household = (id: string, overrides: Partial<CheckoutHousehold> = {}): CheckoutHousehold => ({
  id,
  label: `House ${id}`,
  merchant_id_in_paypal: `MERCHANT${id}`,
  paypal_status: "ready",
  paused: false,
  ...overrides,
});

const line = (item: string, householdId: string, price: number): CheckoutLine => ({
  item_id: item,
  household_id: householdId,
  price,
});

const noFundraiser = { fundraiser_name: null, organizer_merchant_id: null };

describe("toCentsFromNumber", () => {
  it("rounds float prices to whole cents", () => {
    expect(toCentsFromNumber(17.5)).toBe(1750);
    expect(toCentsFromNumber(0.1 + 0.2)).toBe(30);
    expect(toCentsFromNumber(19.99)).toBe(1999);
  });
});

describe("buildCheckoutUnits", () => {
  it("groups lines into one unit per household with matching totals", () => {
    const result = buildCheckoutUnits({
      lines: [line("i1", "h1", 17.5), line("i2", "h2", 5), line("i3", "h1", 2.25)],
      items: [
        { id: "i1", title: "Cast iron pan" },
        { id: "i2", title: "Board game" },
        { id: "i3", title: "Spatula" },
      ],
      households: [household("h1"), household("h2")],
      sale: noFundraiser,
      donationCents: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units.map((u) => [u.referenceId, u.merchantId, u.amount, u.items.length])).toEqual([
      ["h1", "MERCHANTh1", "19.75", 2],
      ["h2", "MERCHANTh2", "5.00", 1],
    ]);
    expect(result.units[0].items[0]).toEqual({ name: "Cast iron pan", quantity: 1, unitAmount: "17.50", sku: "i1" });

    // The units satisfy lib/paypal's own validation (item totals equal unit amounts).
    const parsed = createMultiSellerOrderSchema.safeParse({
      units: result.units.map((u) => ({ referenceId: u.referenceId, merchantId: u.merchantId, amount: u.amount, items: u.items })),
      returnUrl: "https://rummage.test/ok",
      cancelUrl: "https://rummage.test/cancel",
    });
    expect(parsed.success).toBe(true);
  });

  it("adds the donation unit to the organizer when the sale has a fundraiser", () => {
    const result = buildCheckoutUnits({
      lines: [line("i1", "h1", 3)],
      items: [{ id: "i1", title: "Mug" }],
      households: [household("h1")],
      sale: { fundraiser_name: "Forest Park PTA", organizer_merchant_id: "ORGMERCHANT" },
      donationCents: 500,
    });
    expect(result.ok && result.units[1]).toEqual({
      referenceId: DONATION_REFERENCE_ID,
      householdId: null,
      merchantId: "ORGMERCHANT",
      amountCents: 500,
      amount: "5.00",
      items: [{ name: "Donation to Forest Park PTA", quantity: 1, unitAmount: "5.00", sku: DONATION_REFERENCE_ID }],
      description: "Donation to Forest Park PTA",
    });
  });

  it("refuses a donation when the sale takes none", () => {
    const result = buildCheckoutUnits({
      lines: [line("i1", "h1", 3)],
      items: [],
      households: [household("h1")],
      sale: { fundraiser_name: "PTA", organizer_merchant_id: null },
      donationCents: 100,
    });
    expect(result).toMatchObject({ ok: false, status: 400, code: "donations_not_accepted" });
  });

  it("enforces the household cap (9 with a fundraiser, 10 without)", () => {
    const ids = Array.from({ length: 10 }, (_, index) => `h${index}`);
    const input = {
      lines: ids.map((id, index) => line(`i${index}`, id, 1)),
      items: [],
      households: ids.map((id) => household(id)),
      donationCents: 0,
    };
    expect(buildCheckoutUnits({ ...input, sale: noFundraiser }).ok).toBe(true);
    expect(buildCheckoutUnits({ ...input, sale: { fundraiser_name: "PTA", organizer_merchant_id: "ORG" } })).toMatchObject({
      ok: false,
      code: "too_many_households",
    });
  });

  it.each([
    ["missing", []],
    ["paused", [household("h1", { paused: true })]],
    ["not ready", [household("h1", { paypal_status: "pending" })]],
    ["no merchant id", [household("h1", { merchant_id_in_paypal: null })]],
  ])("refuses a seller that is %s", (_label, households) => {
    const result = buildCheckoutUnits({ lines: [line("i1", "h1", 3)], items: [], households, sale: noFundraiser, donationCents: 0 });
    expect(result).toMatchObject({ ok: false, status: 409, code: "seller_not_ready" });
  });

  it("refuses an empty cart and a zero-priced line", () => {
    expect(buildCheckoutUnits({ lines: [], items: [], households: [], sale: noFundraiser, donationCents: 0 })).toMatchObject({
      code: "cart_empty",
    });
    expect(
      buildCheckoutUnits({ lines: [line("i1", "h1", 0)], items: [], households: [household("h1")], sale: noFundraiser, donationCents: 0 }),
    ).toMatchObject({ code: "item_not_payable" });
  });

  it("truncates long titles to PayPal's 127 characters", () => {
    const result = buildCheckoutUnits({
      lines: [line("i1", "h1", 3)],
      items: [{ id: "i1", title: "x".repeat(300) }],
      households: [household("h1")],
      sale: noFundraiser,
      donationCents: 0,
    });
    expect(result.ok && result.units[0].items[0].name.length).toBe(127);
  });
});
