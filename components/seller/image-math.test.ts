import { describe, expect, it } from "vitest";

import {
  base64ByteLength,
  bytesToBase64,
  encodeAttempts,
  fitWithin,
  JPEG_QUALITIES,
  looksLikeImage,
  MAX_PHOTO_SIDE,
  SIZE_STEPS,
} from "./image-math";

describe("fitWithin", () => {
  it("scales a landscape photo so the long side is 1600", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait photo by its height", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it("never scales up", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps a sliver at least one pixel wide", () => {
    expect(fitWithin(10_000, 2)).toEqual({ width: 1600, height: 1 });
  });

  it("rejects empty sizes", () => {
    expect(() => fitWithin(0, 100)).toThrow(RangeError);
    expect(() => fitWithin(100, Number.NaN)).toThrow(RangeError);
  });
});

describe("encodeAttempts", () => {
  it("tries every quality at the fitted size first, best first", () => {
    const attempts = encodeAttempts(4000, 3000);
    expect(attempts.slice(0, JPEG_QUALITIES.length)).toEqual(
      JPEG_QUALITIES.map((quality) => ({ width: 1600, height: 1200, quality })),
    );
  });

  it("then shrinks the size step by step", () => {
    const attempts = encodeAttempts(4000, 3000);
    expect(attempts).toHaveLength(JPEG_QUALITIES.length * SIZE_STEPS);
    expect(attempts[JPEG_QUALITIES.length]).toEqual({ width: 1280, height: 960, quality: JPEG_QUALITIES[0] });
    for (const attempt of attempts) expect(Math.max(attempt.width, attempt.height)).toBeLessThanOrEqual(MAX_PHOTO_SIDE);
  });
});

describe("base64", () => {
  it("encodes bytes without a data-URL prefix", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("/9j/");
  });

  it("handles more bytes than one chunk", () => {
    const bytes = new Uint8Array(100_000).fill(65);
    const encoded = bytesToBase64(bytes);
    expect(base64ByteLength(encoded)).toBe(100_000);
  });

  it("counts decoded bytes with padding", () => {
    expect(base64ByteLength("QQ==")).toBe(1);
    expect(base64ByteLength("QUI=")).toBe(2);
    expect(base64ByteLength("QUJD")).toBe(3);
    expect(base64ByteLength("")).toBe(0);
  });
});

describe("looksLikeImage", () => {
  it("accepts image types and an unknown type", () => {
    expect(looksLikeImage("image/jpeg")).toBe(true);
    expect(looksLikeImage("image/heic")).toBe(true);
    expect(looksLikeImage("")).toBe(true);
  });

  it("refuses other files", () => {
    expect(looksLikeImage("application/pdf")).toBe(false);
  });
});
