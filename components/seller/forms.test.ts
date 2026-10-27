import { describe, expect, it } from "vitest";

import {
  checkPickupCode,
  editItemSchema,
  extractInviteToken,
  fieldErrorsOf,
  formString,
  isOwnPhotoPath,
  joinSaleSchema,
  newItemSchema,
  normalizePickupCode,
  parsePrice,
  photoPathFor,
  priceToInput,
} from "./forms";

const HOUSEHOLD = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_HOUSEHOLD = "11111111-2222-4333-8444-555555555555";
const PHOTO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("parsePrice", () => {
  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["$12.50", 12.5],
    [" 1,200 ", 1200],
    ["0", 0],
  ])("reads %s", (raw, expected) => {
    expect(parsePrice(raw)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1.234", "12.", "100001", "1e3"])("refuses %s", (raw) => {
    expect(parsePrice(raw)).toBeNull();
  });

  it("formats prices back for inputs", () => {
    expect(priceToInput(12)).toBe("12");
    expect(priceToInput(12.5)).toBe("12.50");
    expect(priceToInput(null)).toBe("");
  });
});

describe("extractInviteToken", () => {
  it("keeps a bare code", () => {
    expect(extractInviteToken("  a1b2c3d4e5f6 ")).toBe("a1b2c3d4e5f6");
  });

  it("reads an invite query value from a link", () => {
    expect(extractInviteToken("https://example.test/join?invite=abc123")).toBe("abc123");
    expect(extractInviteToken("/seller?token=def456")).toBe("def456");
  });

  it("falls back to the last path part", () => {
    expect(extractInviteToken("https://example.test/join/xyz789/")).toBe("xyz789");
  });
});

describe("joinSaleSchema", () => {
  it("accepts a code and a table name", () => {
    const parsed = joinSaleSchema.safeParse({ inviteCode: "abc", label: "  The Alvarez table " });
    expect(parsed.success && parsed.data).toEqual({ inviteCode: "abc", label: "The Alvarez table" });
  });

  it("explains a missing code and name", () => {
    const parsed = joinSaleSchema.safeParse({ inviteCode: " ", label: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsOf(parsed.error);
      expect(errors.inviteCode).toMatch(/invite code/);
      expect(errors.label).toMatch(/Name your table/);
    }
  });

  it("refuses a very long table name", () => {
    expect(joinSaleSchema.safeParse({ inviteCode: "abc", label: "x".repeat(81) }).success).toBe(false);
  });
});

describe("photo paths", () => {
  it("builds and recognises a household photo path", () => {
    const path = photoPathFor(HOUSEHOLD, PHOTO);
    expect(path).toBe(`households/${HOUSEHOLD}/${PHOTO}.jpg`);
    expect(isOwnPhotoPath(path, HOUSEHOLD)).toBe(true);
  });

  it("refuses another household's folder and odd paths", () => {
    expect(isOwnPhotoPath(photoPathFor(OTHER_HOUSEHOLD, PHOTO), HOUSEHOLD)).toBe(false);
    expect(isOwnPhotoPath(`households/${HOUSEHOLD}/../x.jpg`, HOUSEHOLD)).toBe(false);
    expect(isOwnPhotoPath(`seed/${PHOTO}.jpg`, HOUSEHOLD)).toBe(false);
  });
});

describe("newItemSchema", () => {
  const valid = {
    householdId: HOUSEHOLD,
    photoPath: photoPathFor(HOUSEHOLD, PHOTO),
    title: " Wooden step stool ",
    description: "",
    category: "furniture",
    condition: "good",
    price: "$8",
    priceLow: 5,
    priceHigh: 12,
    priceReason: "Small solid stools sell for 5 to 12 dollars.",
  };

  it("parses a full listing", () => {
    const parsed = newItemSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ title: "Wooden step stool", description: null, price: 8, priceLow: 5, priceHigh: 12 });
    }
  });

  it("drops a suggested range that is upside down", () => {
    const parsed = newItemSchema.safeParse({ ...valid, priceLow: 20, priceHigh: 10 });
    expect(parsed.success && [parsed.data.priceLow, parsed.data.priceHigh]).toEqual([null, null]);
  });

  it("refuses a photo outside the household's folder", () => {
    const parsed = newItemSchema.safeParse({ ...valid, photoPath: photoPathFor(OTHER_HOUSEHOLD, PHOTO) });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(fieldErrorsOf(parsed.error).photoPath).toMatch(/did not upload/);
  });

  it("explains a bad price and category", () => {
    const parsed = newItemSchema.safeParse({ ...valid, price: "cheap", category: "cars" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsOf(parsed.error);
      expect(errors.price).toMatch(/dollars/);
      expect(errors.category).toBe("Pick a category.");
    }
  });
});

describe("editItemSchema", () => {
  it("parses an edit", () => {
    const parsed = editItemSchema.safeParse({ itemId: PHOTO, title: "Lamp", description: " Works ", price: "4.5" });
    expect(parsed.success && parsed.data).toEqual({ itemId: PHOTO, title: "Lamp", description: "Works", price: 4.5 });
  });

  it("refuses an empty title", () => {
    expect(editItemSchema.safeParse({ itemId: PHOTO, title: " ", description: "", price: "4" }).success).toBe(false);
  });
});

describe("pickup codes", () => {
  it("normalizes case, spaces and dashes", () => {
    expect(normalizePickupCode("ab3 d-ef")).toBe("AB3DEF");
    expect(checkPickupCode("ab3 def")).toEqual({ ok: true, code: "AB3DEF" });
  });

  it("explains characters codes never use", () => {
    const result = checkPickupCode("AB0DEF");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/never use 0, O, 1 or I/);
  });

  it("explains a short or empty code", () => {
    const short = checkPickupCode("ABC");
    expect(!short.ok && short.message).toMatch(/6 letters and numbers/);
    const empty = checkPickupCode("  ");
    expect(!empty.ok && empty.message).toMatch(/Type the code/);
  });
});

describe("formString", () => {
  it("reads strings and ignores files", () => {
    const form = new FormData();
    form.set("title", "Lamp");
    form.set("photo", new Blob(["x"]));
    expect(formString(form, "title")).toBe("Lamp");
    expect(formString(form, "photo")).toBe("");
    expect(formString(form, "missing")).toBe("");
  });
});
