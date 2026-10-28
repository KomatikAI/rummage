"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useTransition, type ChangeEvent } from "react";

import { holdItemAction } from "@/app/sale/[slug]/actions";
import type { SaleItem } from "@/components/buyer/listings";
import { Button, cn } from "@/components/ui";

import { signInHref, type ActionResult } from "../hold-messages";
import { autoScanReducer, autoScanTick, autoStopMessage, initialAutoScan, type AutoScanEvent, type AutoScanState } from "./auto-scan";
import { captureVideoFrame, capturePhotoFile, FrameCaptureError, type CapturedFrame } from "./capture-frame";
import { boxToScreen, placeSticker } from "./frame-math";
import { ScanCard } from "./scan-card";
import type { ScanRequestBody, ScanResponse, ScanTable } from "./scan-types";
import { initialScanView, pointsAtItem, scanViewReducer, type ScanResult } from "./scan-view";
import { useCamera, type CameraStatus } from "./use-camera";

export interface ScanScreenProps {
  sale: { id: string; slug: string; open: boolean };
  /** Tables with something still for sale. */
  tables: ScanTable[];
  /** The whole sale has few enough items to scan without picking a table. */
  wholeSale: boolean;
  /** The table picked when the screen opens, or null. */
  initialHouseholdId: string | null;
}

type Size = { width: number; height: number };

const AUTO_TICK_MS = 500;

const chipClasses = (active: boolean) =>
  cn(
    "inline-flex min-h-tap shrink-0 items-center rounded-pill border px-4 text-sm font-semibold transition-colors",
    active ? "border-ink bg-ink text-paper" : "border-grey-300 bg-surface text-ink hover:bg-paper-deep",
  );

const CAMERA_NOTES: Record<Exclude<CameraStatus, "live">, string> = {
  asking: "Allow the camera to scan the table.",
  denied: "The camera is blocked for this page. Allow it in your browser settings, or use a photo instead.",
  unavailable: "No camera is available here. Use a photo instead.",
  paused: "The camera is paused.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readFailure(json: unknown): { error?: string; households?: ScanTable[] } {
  if (!isRecord(json)) return {};
  return {
    ...(typeof json.error === "string" ? { error: json.error } : {}),
    ...(Array.isArray(json.households) ? { households: json.households as ScanTable[] } : {}),
  };
}

/** Watches an element's size. */
function useSize<T extends HTMLElement>(): [(node: T | null) => void, Size | null] {
  const [size, setSize] = useState<Size | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const next = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }));
    });
    next.observe(node);
    observer.current = next;
  }, []);
  return [ref, size];
}

/** "Scan a table": point the camera at an item, see its price card, hold it. */
export function ScanScreen({ sale, tables, wholeSale, initialHouseholdId }: ScanScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { status: camera } = useCamera(videoRef);
  const [householdId, setHouseholdId] = useState<string | null>(initialHouseholdId);
  const [view, dispatch] = useReducer(scanViewReducer, initialScanView);
  const [photo, setPhoto] = useState<CapturedFrame | null>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [stageRef, stageSize] = useSize<HTMLDivElement>();
  const [cardRef, cardSize] = useSize<HTMLDivElement>();
  const [heldByMe, setHeldByMe] = useState<ReadonlySet<string>>(new Set());
  const [holdMessage, setHoldMessage] = useState<(ActionResult & { itemId: string }) | null>(null);
  const [holdPending, startHold] = useTransition();

  const autoRef = useRef<AutoScanState>(initialAutoScan(0));
  const [autoOn, setAutoOn] = useState(false);
  const [autoStopped, setAutoStopped] = useState<AutoScanState["stopped"]>(null);
  const inFlight = useRef(false);

  const ready = householdId !== null || wholeSale;
  const scanning = view.kind === "scanning";
  const live = camera === "live" && photo === null;

  const setAuto = useCallback((next: AutoScanState) => {
    autoRef.current = next;
    setAutoOn(next.on);
    setAutoStopped(next.stopped);
  }, []);
  const autoEvent = useCallback((event: AutoScanEvent) => setAuto(autoScanReducer(autoRef.current, event)), [setAuto]);

  const send = useCallback(
    async (captured: CapturedFrame) => {
      inFlight.current = true;
      autoEvent({ type: "start", now: Date.now() });
      dispatch({ type: "start" });
      setHoldMessage(null);
      setFrame({ width: captured.width, height: captured.height });
      const body: ScanRequestBody = {
        saleSlug: sale.slug,
        ...(householdId ? { householdId } : {}),
        frameBase64: captured.base64,
        mediaType: "image/jpeg",
      };
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json: unknown = await response.json().catch(() => null);
        if (response.ok && isRecord(json)) dispatch({ type: "response", response: json as ScanResponse });
        else dispatch({ type: "failure", status: response.status, ...readFailure(json) });
      } catch {
        dispatch({ type: "failure", status: 0 });
      } finally {
        inFlight.current = false;
        autoEvent({ type: "finish", now: Date.now() });
      }
    },
    [autoEvent, householdId, sale.slug],
  );

  const scanCamera = useCallback(() => {
    if (inFlight.current || !ready) return;
    const video = videoRef.current;
    if (!video) return;
    let captured: CapturedFrame;
    try {
      captured = captureVideoFrame(video);
    } catch (error) {
      dispatch({
        type: "captureFailed",
        message: error instanceof FrameCaptureError ? error.message : "The camera did not give us a picture. Try again.",
      });
      return;
    }
    void send(captured);
  }, [ready, send]);

  // Auto-scan clock. The latest scanCamera is read from a ref so the interval never resets.
  const scanCameraRef = useRef(scanCamera);
  useEffect(() => {
    scanCameraRef.current = scanCamera;
  }, [scanCamera]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const { state, fire } = autoScanTick(autoRef.current, Date.now());
      setAuto(state);
      if (fire) scanCameraRef.current();
    }, AUTO_TICK_MS);
    return () => window.clearInterval(id);
  }, [setAuto]);

  useEffect(() => {
    autoEvent({ type: "live", live: live && ready });
  }, [autoEvent, live, ready]);

  useEffect(() => {
    const onVisibility = () => autoEvent({ type: "visibility", visible: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [autoEvent]);

  function pickTable(next: string | null) {
    setHouseholdId(next);
    dispatch({ type: "reset" });
    setHoldMessage(null);
  }

  function onScanTap() {
    if (photo) {
      if (!inFlight.current && ready) void send(photo);
      return;
    }
    scanCamera();
  }

  async function onPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || inFlight.current || !ready) return;
    try {
      const captured = await capturePhotoFile(file);
      setPhoto(captured);
      void send(captured);
    } catch (error) {
      dispatch({
        type: "captureFailed",
        message: error instanceof FrameCaptureError ? error.message : "We could not read that photo. Try another one.",
      });
    }
  }

  function onHold(item: SaleItem) {
    setHoldMessage(null);
    startHold(async () => {
      const result = await holdItemAction({ saleId: sale.id, itemId: item.id });
      setHoldMessage({ ...result, itemId: item.id });
      if (result.ok) setHeldByMe((current) => new Set(current).add(item.id));
    });
  }

  const result: ScanResult | null = view.kind === "idle" ? null : view.kind === "scanning" ? view.previous : view;
  const target =
    result && pointsAtItem(result) && frame && stageSize ? boxToScreen(result.box, frame, stageSize) : null;
  const position =
    stageSize && cardSize ? placeSticker(target, cardSize, stageSize) : { left: 0, top: 0 };
  const cardHasHold =
    result?.kind === "match" &&
    !scanning &&
    sale.open &&
    result.item.status === "available" &&
    result.item.acceptsPayments &&
    !heldByMe.has(result.item.id);
  const canScan = ready && !scanning && (live || photo !== null);
  const stopLine = autoStopMessage(autoStopped);

  return (
    <div className="flex flex-col gap-4" onPointerDown={() => autoEvent({ type: "tap", now: Date.now() })}>
      <section aria-label="Your table" className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Which table are you at?</p>
        <div className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-1">
          {wholeSale ? (
            <button type="button" aria-pressed={householdId === null} className={chipClasses(householdId === null)} onClick={() => pickTable(null)}>
              Whole sale
            </button>
          ) : null}
          {tables.map((table) => (
            <button
              key={table.householdId}
              type="button"
              aria-pressed={householdId === table.householdId}
              className={chipClasses(householdId === table.householdId)}
              onClick={() => pickTable(table.householdId)}
            >
              {table.label}
            </button>
          ))}
        </div>
        {!ready ? <p className="text-sm text-ink-soft">Pick a table to start scanning.</p> : null}
      </section>

      <div ref={stageRef} className="relative h-[70dvh] min-h-80 overflow-hidden rounded-sticker bg-ink">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Camera view"
          className={cn("absolute inset-0 h-full w-full object-cover", photo && "invisible")}
        />
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.dataUrl} alt="Your photo" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        {camera !== "live" && !photo ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-paper">
            <p className="max-w-xs text-base">{CAMERA_NOTES[camera]}</p>
          </div>
        ) : null}
        {scanning ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-8 animate-pulse rounded-sticker border-2 border-paper motion-reduce:animate-none"
          />
        ) : null}
        {scanning ? <p className="sr-only" role="status">Matching</p> : null}
        {result ? (
          <ScanCard
            ref={cardRef}
            result={result}
            visible={!scanning}
            placed={stageSize !== null && cardSize !== null}
            position={position}
            saleOpen={sale.open}
            heldByMe={heldByMe}
            holdPending={holdPending}
            holdMessage={holdMessage}
            signInHref={signInHref(`/sale/${sale.slug}/scan`)}
            onHold={onHold}
            onChoose={(item) => dispatch({ type: "choose", item })}
            onPickTable={(id) => pickTable(id)}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Button size="lg" fullWidth variant={cardHasHold ? "secondary" : "primary"} loading={scanning} disabled={!canScan} onClick={onScanTap}>
          {photo ? "Scan this photo" : "Scan"}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <button
              type="button"
              aria-pressed={autoOn}
              disabled={!ready}
              className={cn(chipClasses(autoOn), "disabled:opacity-55")}
              onClick={() => autoEvent({ type: "toggle", now: Date.now() })}
            >
              {autoOn ? "Auto is on" : "Auto"}
            </button>
          ) : null}
          {photo && camera === "live" ? (
            <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}>
              Back to the camera
            </Button>
          ) : null}
          <label className={cn(chipClasses(false), "cursor-pointer focus-within:outline-2 focus-within:outline-accent")}>
            Use a photo instead
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void onPhoto(event)} />
          </label>
        </div>
        {autoOn ? <p className="text-sm text-ink-soft">Scanning every few seconds while you hold the phone still.</p> : null}
        {stopLine ? <p className="text-sm text-ink-soft">{stopLine}</p> : null}
        <p className="text-sm text-ink-soft">Photos from your camera are matched and thrown away. Nothing is saved.</p>
      </div>
    </div>
  );
}
