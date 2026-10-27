import { z } from "zod";

import type { TablesInsert } from "@/lib/supabase/types";

/**
 * The "Start a sale" form: raw values from FormData, validation, and the insert row.
 * Every field arrives as a string; errors are keyed by field so the form can show
 * each one under its control.
 */

/** The demo sale's meeting area, shown as the example. Address-free: a point and a radius. */
export const EXAMPLE_AREA = { lat: "38.6382", lng: "-90.2847", radiusM: "1200" } as const;

export const SALE_FORM_FIELDS = [
  "name",
  "saleDate",
  "startsAt",
  "endsAt",
  "description",
  "areaLat",
  "areaLng",
  "areaRadiusM",
  "fundraiserName",
  "fundraiserGoal",
] as const;

export type SaleFormField = (typeof SALE_FORM_FIELDS)[number];
export type SaleFormValues = Record<SaleFormField, string>;
export type SaleFormErrors = Partial<Record<SaleFormField, string>>;

export interface SaleFormState {
  values: SaleFormValues;
  fieldErrors?: SaleFormErrors;
  formError?: string;
}

export const DESCRIPTION_MAX_LENGTH = 600;

export const EMPTY_SALE_FORM: SaleFormValues = {
  name: "",
  saleDate: "",
  startsAt: "08:00",
  endsAt: "14:00",
  description: "",
  areaLat: EXAMPLE_AREA.lat,
  areaLng: EXAMPLE_AREA.lng,
  areaRadiusM: EXAMPLE_AREA.radiusM,
  fundraiserName: "",
  fundraiserGoal: "",
};

/** Reads the form's fields as trimmed strings ("" when missing). */
export function readSaleForm(formData: FormData): SaleFormValues {
  const values = { ...EMPTY_SALE_FORM };
  for (const field of SALE_FORM_FIELDS) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw.trim() : "";
  }
  return values;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;

function isRealDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** A required numeric field within [min, max]. */
function numberIn(min: number, max: number, message: string) {
  return z
    .string()
    .refine((value) => value !== "" && Number.isFinite(Number(value)), message)
    .transform(Number)
    .refine((value) => value >= min && value <= max, message);
}

function goalDollars(value: string): number | null {
  const bare = value.replace(/^\$/, "").replace(/,/g, "");
  return bare === "" ? null : Number(bare);
}

const RADIUS_MESSAGE = "The radius is a whole number of metres from 50 to 50,000.";

const saleFormSchema = z
  .object({
    name: z.string().min(1, "Give the sale a name.").max(120, "Keep the name under 120 characters."),
    saleDate: z.string().refine(isRealDate, "Pick the day of the sale."),
    startsAt: z.string().regex(TIME_RE, "Pick a start time."),
    endsAt: z.string().regex(TIME_RE, "Pick an end time."),
    description: z
      .string()
      .max(DESCRIPTION_MAX_LENGTH, `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.`),
    areaLat: numberIn(-90, 90, "Latitude is a number between -90 and 90."),
    areaLng: numberIn(-180, 180, "Longitude is a number between -180 and 180."),
    areaRadiusM: numberIn(50, 50000, RADIUS_MESSAGE).refine(Number.isInteger, RADIUS_MESSAGE),
    fundraiserName: z.string().max(120, "Keep the fundraiser name under 120 characters."),
    fundraiserGoal: z
      .string()
      .refine(
        (value) => value === "" || MONEY_RE.test(value.replace(/^\$/, "").replace(/,/g, "")),
        "Enter the goal in dollars, like 500.",
      )
      .transform(goalDollars)
      .refine((value) => value === null || value > 0, "The goal needs to be more than $0."),
  })
  .superRefine((data, ctx) => {
    if (toMinutes(data.endsAt) <= toMinutes(data.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The sale needs to end after it starts." });
    }
    if (data.fundraiserGoal !== null && data.fundraiserName === "") {
      ctx.addIssue({ code: "custom", path: ["fundraiserName"], message: "Name the fundraiser to set a goal." });
    }
  });

export type SaleFormInput = z.output<typeof saleFormSchema>;

export type ParsedSaleForm = { ok: true; data: SaleFormInput } | { ok: false; fieldErrors: SaleFormErrors };

function isSaleFormField(value: unknown): value is SaleFormField {
  return typeof value === "string" && (SALE_FORM_FIELDS as readonly string[]).includes(value);
}

/** Validates the raw values. The first problem per field is kept. */
export function parseSaleForm(values: SaleFormValues): ParsedSaleForm {
  const parsed = saleFormSchema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: SaleFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (isSaleFormField(field)) fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

function hhmm(value: string): string {
  const [hours, minutes] = value.split(":");
  return `${hours}:${minutes}`;
}

/**
 * The insert row. Only columns organizers may insert are set; status is left to its
 * 'draft' default and the invite token to its random default.
 */
export function toSaleInsert(data: SaleFormInput, organizerUserId: string, slug: string): TablesInsert<"sales"> {
  const hasFundraiser = data.fundraiserName !== "";
  return {
    organizer_user_id: organizerUserId,
    name: data.name,
    slug,
    description: data.description === "" ? null : data.description,
    sale_date: data.saleDate,
    starts_at: hhmm(data.startsAt),
    ends_at: hhmm(data.endsAt),
    area_lat: data.areaLat,
    area_lng: data.areaLng,
    area_radius_m: data.areaRadiusM,
    fundraiser_name: hasFundraiser ? data.fundraiserName : null,
    fundraiser_goal: hasFundraiser ? data.fundraiserGoal : null,
  };
}
