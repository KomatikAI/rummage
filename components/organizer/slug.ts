/** Sale slugs: lower-case words joined by single hyphens, as the sales.slug check requires. */

export const SLUG_MAX_LENGTH = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Used when a name has no letters or digits at all. */
const FALLBACK_SLUG = "sale";

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

/**
 * "Maple Street PTA: Spring Rummage!" -> "maple-street-pta-spring-rummage".
 * Accents are folded ("Café" -> "cafe"), "&" becomes "and", and the result is cut to
 * 80 characters on a clean boundary. Never returns an empty string.
 */
export function slugify(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-");
  const slug = trimHyphens(trimHyphens(folded).slice(0, SLUG_MAX_LENGTH));
  return slug || FALLBACK_SLUG;
}

/**
 * Appends a short suffix for a second try when the slug is taken, keeping the total
 * within 80 characters: ("spring-sale", "4f2a") -> "spring-sale-4f2a".
 */
export function slugWithSuffix(slug: string, suffix: string): string {
  const cleanSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "") || "1";
  const room = SLUG_MAX_LENGTH - cleanSuffix.length - 1;
  const head = trimHyphens(slug.slice(0, Math.max(room, 1))) || FALLBACK_SLUG;
  return `${head}-${cleanSuffix}`;
}
