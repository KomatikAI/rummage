import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";

import { SaleNameProvider } from "@/components/sale-name";
import { TabBar } from "@/components/tab-bar";
import { TopBar } from "@/components/top-bar";

import "./globals.css";

const display = Fraunces({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rummage",
  description: "A whole neighbourhood yard sale on one map, paid in one checkout.",
};

export const viewport: Viewport = {
  themeColor: "#fbf6ec",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col bg-paper font-sans text-ink">
        <a
          href="#main"
          className="sr-only z-50 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-paper focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <SaleNameProvider>
          <TopBar />
          <div className="flex flex-1 flex-col pb-tabbar md:pb-0">{children}</div>
          <TabBar />
        </SaleNameProvider>
      </body>
    </html>
  );
}
