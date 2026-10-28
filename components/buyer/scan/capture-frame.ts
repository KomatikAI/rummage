import { FRAME_JPEG_QUALITY, frameSize } from "./frame-math";

/**
 * Browser only (except `stripDataUrlPrefix`). Grabs one frame from the live camera, or
 * from a photo the buyer picked, scaled to at most 768 px on its long side and encoded as
 * a JPEG. Nothing is kept: the caller sends the base64 and drops it.
 */

export type CapturedFrame = {
  /** JPEG base64, without the data-URL prefix. */
  base64: string;
  /** The same JPEG as a data URL, for showing a picked photo in place of the video. */
  dataUrl: string;
  width: number;
  height: number;
};

export class FrameCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameCaptureError";
  }
}

/** "data:image/jpeg;base64,AAAA" -> "AAAA"; plain base64 is returned as is. */
export function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
}

function encode(source: CanvasImageSource, width: number, height: number): CapturedFrame {
  const size = frameSize(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new FrameCaptureError("This browser cannot read the camera. Try another browser.");
  // JPEG has no transparency: paint white first so clear pixels do not turn black.
  context.fillStyle = "white";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(source, 0, 0, size.width, size.height);
  const dataUrl = canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY);
  return { base64: stripDataUrlPrefix(dataUrl), dataUrl, width: size.width, height: size.height };
}

/** The current frame of a playing camera video. */
export function captureVideoFrame(video: HTMLVideoElement): CapturedFrame {
  if (!video.videoWidth || !video.videoHeight) {
    throw new FrameCaptureError("The camera is still starting. Try again in a moment.");
  }
  return encode(video, video.videoWidth, video.videoHeight);
}

/** A picked or freshly taken photo, with its orientation applied. */
export async function capturePhotoFile(file: File): Promise<CapturedFrame> {
  if (!file.type.startsWith("image/")) throw new FrameCaptureError("That file is not a photo. Pick a JPEG or PNG.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new FrameCaptureError("We could not read that photo. Try a JPEG or PNG, or take a new one.");
  }
  try {
    return encode(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
