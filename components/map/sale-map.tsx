"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import type { HouseholdPin } from "@/components/buyer/listings";

import { boundsCenter, boundsFromPoints, OPENFREEMAP_STYLE, pinLabel } from "./bounds";

export interface SaleMapProps {
  pins: HouseholdPin[];
  selectedHouseholdId: string | null;
  onSelectHousehold: (householdId: string) => void;
}

const PIN_BASE =
  "flex size-tap items-center justify-center rounded-pill border-2 border-surface font-semibold text-sm shadow-sticker cursor-pointer";
const PIN_IDLE = ["bg-accent", "text-on-accent"];
const PIN_SELECTED = ["bg-ink", "text-paper", "scale-110"];

/**
 * The sale map: OpenFreeMap tiles, one pin per household at its jittered public spot,
 * with a count of the items still for sale. Tapping a pin selects that household.
 * Client only (MapLibre needs the DOM); load it through `LazySaleMap`.
 */
export function SaleMap({ pins, selectedHouseholdId, onSelectHousehold }: SaleMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, { marker: Marker; element: HTMLButtonElement }>());
  const bounds = useMemo(() => boundsFromPoints(pins), [pins]);
  const select = useEffectEvent((householdId: string) => onSelectHousehold(householdId));

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: OPENFREEMAP_STYLE,
      center: bounds ? boundsCenter(bounds) : [-98.5, 39.8],
      zoom: bounds ? 14 : 3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    const markers = markersRef.current;
    return () => {
      observer.disconnect();
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
    // The camera follows `bounds` in the effect below; the map itself is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One marker per household; rebuilt when the pins change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    for (const { marker } of markers.values()) marker.remove();
    markers.clear();

    for (const pin of pins) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = PIN_BASE;
      element.classList.add(...PIN_IDLE);
      element.textContent = String(pin.count);
      element.setAttribute("aria-label", pinLabel(pin.label, pin.count));
      element.title = pin.label;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        select(pin.householdId);
      });
      const marker = new Marker({ element, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map);
      markers.set(pin.householdId, { marker, element });
    }

    if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
  }, [pins, bounds]);

  // Show which household is selected.
  useEffect(() => {
    for (const [householdId, { element }] of markersRef.current) {
      const selected = householdId === selectedHouseholdId;
      element.classList.remove(...(selected ? PIN_IDLE : PIN_SELECTED));
      element.classList.add(...(selected ? PIN_SELECTED : PIN_IDLE));
      element.setAttribute("aria-pressed", selected ? "true" : "false");
    }
  }, [selectedHouseholdId, pins]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Map of the tables in this sale"
      className="size-full overflow-hidden rounded-sticker border border-line bg-paper-deep"
    />
  );
}
