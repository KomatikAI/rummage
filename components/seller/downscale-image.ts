import { bytesToBase64, encodeAttempts, looksLikeImage, MAX_PHOTO_BYTES } from "./image-math";

/** A downscaled JPEG, ready to preview, price and upload. */
export type PreparedPhoto = {
  blob: Blob;
  /** Base64 of the JPEG, no data-URL prefix. */
  base64: string;
  width: number;
  height: number;
  bytes: number;
};

export class PhotoPrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoPrepError";
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PhotoPrepError("We could not save that photo. Try another one."))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Browser only. Reads a camera or gallery file, scales it so its longest side is at
 * most 1600 px and re-encodes it as a JPEG of at most 1 MB, before anything leaves the
 * phone. Orientation from the photo's metadata is applied while decoding.
 */
export async function downscaleImage(file: File): Promise<PreparedPhoto> {
  if (!looksLikeImage(file.type)) {
    throw new PhotoPrepError("That file is not a photo. Pick a JPEG or PNG.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoPrepError("We could not read that photo. Try a JPEG or PNG, or take a new one.");
  }

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoPrepError("This browser cannot resize photos. Try another browser.");

    let last: { blob: Blob; width: number; height: number } | null = null;
    for (const attempt of encodeAttempts(bitmap.width, bitmap.height)) {
      if (canvas.width !== attempt.width || canvas.height !== attempt.height) {
        canvas.width = attempt.width;
        canvas.height = attempt.height;
        // JPEG has no transparency: paint white first so clear pixels do not turn black.
        context.fillStyle = "white";
        context.fillRect(0, 0, attempt.width, attempt.height);
        context.drawImage(bitmap, 0, 0, attempt.width, attempt.height);
      }
      const blob = await toJpeg(canvas, attempt.quality);
      last = { blob, width: attempt.width, height: attempt.height };
      if (blob.size <= MAX_PHOTO_BYTES) break;
    }
    if (!last || last.blob.size > MAX_PHOTO_BYTES) {
      throw new PhotoPrepError("That photo is too detailed to shrink. Try another one.");
    }

    const base64 = bytesToBase64(new Uint8Array(await last.blob.arrayBuffer()));
    return { blob: last.blob, base64, width: last.width, height: last.height, bytes: last.blob.size };
  } finally {
    bitmap.close();
  }
}
