"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * The back camera as a hook. It asks once on mount, shows the stream in `videoRef`, and
 * stops every track when the screen unmounts, when the page is hidden (another tab, the
 * phone locked) and on pagehide; it asks again when the page comes back.
 */

export type CameraStatus =
  /** Waiting for the permission prompt or the first frame. */
  | "asking"
  | "live"
  | "denied"
  /** No camera, no getUserMedia, or not a secure (https) page. */
  | "unavailable"
  /** Stopped while the page is hidden. */
  | "paused";

const CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
  audio: false,
};

function stopAll(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): { status: CameraStatus } {
  const [status, setStatusState] = useState<CameraStatus>("asking");
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<CameraStatus>("asking");

  const setStatus = useCallback((next: CameraStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const stop = useCallback(() => {
    stopAll(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      await Promise.resolve();
      if (cancelled) return;
      if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      setStatus("asking");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
        return;
      }
      if (cancelled) {
        stopAll(stream);
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // autoPlay covers most browsers; play() covers the rest. A rejected play is fine.
        void video.play().catch(() => undefined);
      }
      setStatus("live");
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [attempt, setStatus, stop, videoRef]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        stop();
        if (statusRef.current === "live" || statusRef.current === "asking") setStatus("paused");
      } else if (statusRef.current === "paused") {
        setAttempt((n) => n + 1);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [setStatus, stop]);

  return { status };
}
