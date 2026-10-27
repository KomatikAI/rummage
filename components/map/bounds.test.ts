import { describe, expect, it } from "vitest";

import { boundsCenter, boundsFromPoints, OPENFREEMAP_STYLE, pinLabel } from "./bounds";

describe("boundsFromPoints", () => {
  it("fits every pin", () => {
    expect(
      boundsFromPoints(
        [
          { lng: -90.289, lat: 38.6376 },
          { lng: -90.2796, lat: 38.6355 },
          { lng: -90.2926, lat: 38.641 },
        ],
        0,
      ),
    ).toEqual([
      [-90.2926, 38.6355],
      [-90.2796, 38.641],
    ]);
  });

  it("widens a single pin to the minimum span", () => {
    const bounds = boundsFromPoints([{ lng: 10, lat: 20 }], 0.004);
    expect(bounds).not.toBeNull();
    const [[west, south], [east, north]] = bounds!;
    expect(east - west).toBeCloseTo(0.004);
    expect(north - south).toBeCloseTo(0.004);
    expect(boundsCenter(bounds!)[0]).toBeCloseTo(10);
    expect(boundsCenter(bounds!)[1]).toBeCloseTo(20);
  });

  it("ignores invalid points and returns null with none left", () => {
    expect(boundsFromPoints([])).toBeNull();
    expect(boundsFromPoints([{ lng: Number.NaN, lat: 1 }, { lng: 200, lat: 1 }])).toBeNull();
  });
});

describe("constants and labels", () => {
  it("uses the OpenFreeMap style", () => {
    expect(OPENFREEMAP_STYLE).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("labels pins", () => {
    expect(pinLabel("Oak corner", 1)).toBe("Oak corner, 1 item");
    expect(pinLabel("Oak corner", 4)).toBe("Oak corner, 4 items");
  });
});
