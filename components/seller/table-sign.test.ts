import { describe, expect, it } from "vitest";

import { qrSvg, tableScanUrl } from "./table-sign";

describe("tableScanUrl", () => {
  it("builds the scan link for one table", () => {
    expect(tableScanUrl("https://rummage.test/", "oak-lane-sale", "b0000000-0000-4000-8000-000000000001")).toBe(
      "https://rummage.test/sale/oak-lane-sale/scan?household=b0000000-0000-4000-8000-000000000001",
    );
  });

  it("encodes the slug and the id", () => {
    expect(tableScanUrl("https://rummage.test", "a b", "x&y")).toBe("https://rummage.test/sale/a%20b/scan?household=x%26y");
  });
});

describe("qrSvg", () => {
  it("renders a scalable ink-on-white SVG", async () => {
    const svg = await qrSvg("https://rummage.test/sale/oak-lane-sale/scan?household=1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/);
    expect(svg).toContain("#2a2520");
    expect(svg).toContain("#ffffff");
  });
});
