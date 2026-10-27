/**
 * Pure helpers for the seller's photo downscale. The browser part (canvas, toBlob)
 * lives in downscale-image.ts; everything here runs in Node too, so it is tested.
 */

/** Longest side of the photo we keep, in pixels. */
export const MAX_PHOTO_SIDE = 1600;
/** Largest JPEG we upload or send for pricing, in bytes. */
export const MAX_PHOTO_BYTES = 1_000_000;
/** JPEG qualities tried at each size, best first. */
export const JPEG_QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;
/** Each extra size step shrinks both sides by this factor. */
export const SHRINK_FACTOR = 0.8;
/** Size steps tried before giving up and taking the smallest attempt. */
export const SIZE_STEPS = 4;

export type Size = { width: number; height: number };
export type EncodeAttempt = Size & { quality: number };

/** Scales a size down (never up) so its longest side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number = MAX_PHOTO_SIDE): Size {
  if (!(width > 0) || !(height > 0)) throw new RangeError("width and height must be positive");
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Every encode to try, in order: each quality at the fitted size, then each quality at
 * smaller sizes. The caller stops at the first result that fits in MAX_PHOTO_BYTES.
 */
export function encodeAttempts(width: number, height: number): EncodeAttempt[] {
  const fitted = fitWithin(width, height);
  const attempts: EncodeAttempt[] = [];
  for (let step = 0; step < SIZE_STEPS; step += 1) {
    const scale = SHRINK_FACTOR ** step;
    const size = {
      width: Math.max(1, Math.round(fitted.width * scale)),
      height: Math.max(1, Math.round(fitted.height * scale)),
    };
    for (const quality of JPEG_QUALITIES) attempts.push({ ...size, quality });
  }
  return attempts;
}

/** Encodes bytes as base64 without a data-URL prefix. Chunked so big photos do not overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Bytes a base64 string decodes to. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** True for a file type the browser can usually decode into a canvas. */
export function looksLikeImage(type: string): boolean {
  return type === "" || type.startsWith("image/");
}
