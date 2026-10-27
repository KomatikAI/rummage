"use client";

import dynamic from "next/dynamic";

import { Spinner } from "@/components/ui";

function MapLoading({ small = false }: { small?: boolean }) {
  return (
    <div
      className={
        small
          ? "flex h-44 w-full items-center justify-center rounded-field bg-paper-deep"
          : "flex size-full items-center justify-center rounded-sticker bg-paper-deep"
      }
    >
      <Spinner label="Loading the map" />
    </div>
  );
}

/** The sale map, loaded only in the browser. */
export const LazySaleMap = dynamic(() => import("./sale-map").then((mod) => mod.SaleMap), {
  ssr: false,
  loading: () => <MapLoading />,
});

/** The pickup map, loaded only in the browser. */
export const LazyPickupMap = dynamic(() => import("./pickup-map").then((mod) => mod.PickupMap), {
  ssr: false,
  loading: () => <MapLoading small />,
});
