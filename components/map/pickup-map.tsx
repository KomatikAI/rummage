"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { boundsCenter, boundsFromPoints, OPENFREEMAP_STYLE } from "./bounds";

export interface PickupMapProps {
  /** The exact table position (paid units only). */
  lng: number;
  lat: number;
  label: string;
}

/**
 * A small map with one exact pin: where to collect a paid table's items.
 * Two-finger pan on phones so the page still scrolls. Load it through `LazyPickupMap`.
 */
export function PickupMap({ lng, lat, label }: PickupMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const bounds = boundsFromPoints([{ lng, lat }], 0.003);
    const map = new MapLibreMap({
      container,
      style: OPENFREEMAP_STYLE,
      center: bounds ? boundsCenter(bounds) : [lng, lat],
      zoom: 16,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
    });

    const element = document.createElement("div");
    element.className = "size-6 rounded-pill border-4 border-surface bg-ready shadow-sticker";
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    const marker = new Marker({ element, anchor: "center" }).setLngLat([lng, lat]).addTo(map);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      marker.remove();
      map.remove();
    };
  }, [lng, lat, label]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Map showing ${label}`}
      className="h-44 w-full overflow-hidden rounded-field border border-line bg-paper-deep"
    />
  );
}
