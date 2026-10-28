import { fitWithin, type Size } from "@/components/seller/image-math";

import type { ScanBox } from "./scan-types";

/**
 * Pure geometry for the scan screen: how big a frame to send, where a box in the frame
 * lands on screen under `object-fit: cover`, and where the price card goes. Runs in Node
 * too, so it is tested.
 */

/** Longest side of a frame sent for matching, in pixels. */
export const MAX_FRAME_SIDE = 768;
/** JPEG quality of a sent frame. */
export const FRAME_JPEG_QUALITY = 0.7;
/** Space kept between the card and the edge of the camera view, in pixels. */
export const STICKER_GUTTER = 16;
/** Space between the card and the item it points at, in pixels. */
export const STICKER_GAP = 12;

export type Rect = { left: number; top: number; width: number; height: number };

/** The size a camera frame is scaled to (never up) before it is sent. */
export function frameSize(width: number, height: number): Size {
  return fitWithin(width, height, MAX_FRAME_SIDE);
}

/**
 * Where an `object-fit: cover` image of `frame` size is drawn inside a `view`: scaled to
 * fill the view and centred, so the overflow is cropped equally on both sides.
 */
export function coverRect(frame: Size, view: Size): Rect {
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { left: (view.width - width) / 2, top: (view.height - height) / 2, width, height };
}

/** A box in frame fractions, in view pixels under `object-fit: cover`. */
export function boxToScreen(box: ScanBox, frame: Size, view: Size): Rect {
  const drawn = coverRect(frame, view);
  return {
    left: drawn.left + box.x * drawn.width,
    top: drawn.top + box.y * drawn.height,
    width: box.w * drawn.width,
    height: box.h * drawn.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  // When the card is bigger than the room, pin it to the start edge.
  return max < min ? min : Math.min(max, Math.max(min, value));
}

/**
 * Top-left corner of the price card in view pixels. Centred under the item when it fits,
 * else above it, else over its centre; bottom-centre when there is no item to point at.
 * Always clamped inside the view with a STICKER_GUTTER margin.
 */
export function placeSticker(target: Rect | null, card: Size, view: Size): { left: number; top: number } {
  const minLeft = STICKER_GUTTER;
  const maxLeft = view.width - STICKER_GUTTER - card.width;
  const minTop = STICKER_GUTTER;
  const maxTop = view.height - STICKER_GUTTER - card.height;

  if (!target) {
    return { left: clamp((view.width - card.width) / 2, minLeft, maxLeft), top: clamp(maxTop, minTop, maxTop) };
  }

  const centreX = target.left + target.width / 2;
  const below = target.top + target.height + STICKER_GAP;
  const above = target.top - STICKER_GAP - card.height;
  let top: number;
  if (below <= maxTop) top = below;
  else if (above >= minTop) top = above;
  else top = target.top + target.height / 2 - card.height / 2;

  return { left: clamp(centreX - card.width / 2, minLeft, maxLeft), top: clamp(top, minTop, maxTop) };
}
