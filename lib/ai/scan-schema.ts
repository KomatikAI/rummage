import { z } from "zod";

/**
 * Structured output for scan matching: which listed item a buyer's camera frame shows.
 *
 * The wire schema deliberately carries no numeric bounds or length limits (structured
 * outputs does not enforce them). `sanitizeScanReply` in scan-match.ts applies them after
 * parsing: unknown ids are dropped, the box is clamped into the frame, prices are rounded.
 */

export const SCAN_CONFIDENCES = ["high", "medium", "low"] as const;
export const ScanConfidence = z.enum(SCAN_CONFIDENCES);
export type ScanConfidence = z.infer<typeof ScanConfidence>;

export const ScanBox = z.strictObject({
  x: z.number().describe("Left edge, 0 to 1 of the frame width, from the top-left corner"),
  y: z.number().describe("Top edge, 0 to 1 of the frame height, from the top-left corner"),
  w: z.number().describe("Width, 0 to 1 of the frame width"),
  h: z.number().describe("Height, 0 to 1 of the frame height"),
});
export type ScanBox = z.infer<typeof ScanBox>;

export const ScanReply = z.strictObject({
  match: z
    .strictObject({
      item_id: z.string().describe("The id of the listed item in the frame, copied exactly from its label"),
      confidence: ScanConfidence.describe("How sure the match is"),
      box: ScanBox.nullable().describe("Where the matched item is in the camera frame, or null when unclear"),
    })
    .nullable()
    .describe("The listed item the camera frame shows, or null when none of them is in the frame"),
  alternatives: z
    .array(z.string())
    .describe("Up to 3 other listed item ids it could be, most likely first; never the matched id"),
  not_listed: z
    .strictObject({
      title: z.string().describe("What the thing looks like, under 60 characters"),
      price_low: z.number().describe("Low end of a yard-sale price estimate, in US dollars"),
      price_high: z.number().describe("High end of a yard-sale price estimate, in US dollars"),
    })
    .nullable()
    .describe("Only when no listed item matches: what the thing looks like and a rough yard-sale price"),
});
export type ScanReply = z.infer<typeof ScanReply>;

type JsonObject = { [key: string]: unknown };

function withoutSchemaKey(schema: JsonObject): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  void _ignored;
  return rest;
}

/** JSON schema for `output_config.format`, generated with `z.toJSONSchema` (inlined). */
export const scanReplyJsonSchema = withoutSchemaKey(
  z.toJSONSchema(ScanReply, { reused: "inline", io: "output" }) as JsonObject,
);

/** The exact `output_config.format` value sent with a scan request. */
export const scanReplyOutputFormat = {
  type: "json_schema" as const,
  schema: scanReplyJsonSchema,
};
