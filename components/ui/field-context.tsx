"use client";

import { createContext, use } from "react";

export interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/** Read by Input and Textarea so a Field can wire ids, aria-describedby and aria-invalid. */
export function useFieldContext(): FieldContextValue | null {
  return use(FieldContext);
}
