/**
 * Pure map helpers: the tile style, bounds that fit a set of pins, and the camera to use
 * when there is only one pin or none.
 */

/** OpenFreeMap's hosted style. Never raw OpenStreetMap tiles. */
export const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export type LngLat = { lng: number; lat: number };

/** [[west, south], [east, north]]. */
export type Bounds = [[number, number], [number, number]];

function isValid(point: LngLat): boolean {
  return (
    Number.isFinite(point.lng) &&
    Number.isFinite(point.lat) &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    point.lat >= -90 &&
    point.lat <= 90
  );
}

/**
 * Bounds around every valid point, widened to at least `minSpanDeg` on each axis so a
 * single pin (or pins on one street) does not zoom to street-lamp level. Null when there
 * is no valid point.
 */
export function boundsFromPoints(points: readonly LngLat[], minSpanDeg = 0.004): Bounds | null {
  const valid = points.filter(isValid);
  if (valid.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of valid) {
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const widen = (low: number, high: number): [number, number] => {
    const span = high - low;
    if (span >= minSpanDeg) return [low, high];
    const pad = (minSpanDeg - span) / 2;
    return [low - pad, high + pad];
  };
  [west, east] = widen(west, east);
  [south, north] = widen(south, north);
  return [
    [Math.max(-180, west), Math.max(-90, south)],
    [Math.min(180, east), Math.min(90, north)],
  ];
}

/** The centre of some bounds, for the map's first frame before fitBounds runs. */
export function boundsCenter(bounds: Bounds): [number, number] {
  return [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
}

/** Pin label for screen readers: "The Alvarez table, 5 items". */
export function pinLabel(label: string, count: number): string {
  return `${label}, ${count === 1 ? "1 item" : `${count} items`}`;
}
