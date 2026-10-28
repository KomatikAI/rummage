import QRCode from "qrcode";

/**
 * The printable table sign: the scan link for one table and its QR code. Used by the
 * server page only (the QR is rendered to an SVG string there, so the qrcode package
 * never reaches a client bundle).
 */

/** Ink on white: the `--color-ink` and `--color-white` token values, for the SVG fill. */
const QR_DARK = "#2a2520";
const QR_LIGHT = "#ffffff";

/** `${APP_URL}/sale/<slug>/scan?household=<id>`. */
export function tableScanUrl(appUrl: string, saleSlug: string, householdId: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/sale/${encodeURIComponent(saleSlug)}/scan?household=${encodeURIComponent(householdId)}`;
}

/** The QR code for `url` as an SVG string that scales to its container. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
}
