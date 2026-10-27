"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";

interface SaleNameContextValue {
  name: string | null;
  setName: (name: string | null) => void;
}

const SaleNameContext = createContext<SaleNameContextValue | null>(null);

/** Wraps the app in app/layout.tsx so a page can put its sale name in the top bar. */
export function SaleNameProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  return <SaleNameContext value={{ name, setName }}>{children}</SaleNameContext>;
}

/**
 * Render this anywhere on a sale page to show the sale's name in the top bar:
 * `<SetSaleName name={sale.name} />`. It renders nothing and clears the name on leave.
 */
export function SetSaleName({ name }: { name: string }) {
  const context = use(SaleNameContext);
  const setName = context?.setName;
  useEffect(() => {
    if (!setName) return;
    setName(name);
    return () => setName(null);
  }, [name, setName]);
  return null;
}

/** The top bar's slot for the current sale name. */
export function CurrentSaleName() {
  const context = use(SaleNameContext);
  if (!context?.name) return null;
  return (
    <span className="min-w-0 truncate border-l border-line pl-3 text-sm font-semibold text-ink-soft">{context.name}</span>
  );
}
