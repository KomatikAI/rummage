"use client";

import { Button } from "@/components/ui";

/** Opens the browser's print dialog. Hidden on the printed page itself. */
export function PrintButton({ children }: { children: string }) {
  return (
    <Button size="lg" fullWidth className="print:hidden" onClick={() => window.print()}>
      {children}
    </Button>
  );
}
