/** Joins class names, skipping empty values. It does not resolve Tailwind conflicts. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
