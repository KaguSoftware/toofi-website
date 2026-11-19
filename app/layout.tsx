import type { Metadata, Viewport } from "next";
import { Amiri, IBM_Plex_Sans_Arabic, Manrope, Young_Serif } from "next/font/google";
import "./globals.css";

// Display: Young Serif (sturdy, warm old-style). Body: Manrope.
// Arabic: Amiri (Naskh) for headings, IBM Plex Sans Arabic for text.
const young = Young_Serif({ variable: "--font-young", weight: "400", subsets: ["latin"], display: "swap" });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], display: "swap" });
const amiri = Amiri({ variable: "--font-amiri", weight: ["400", "700"], subsets: ["arabic"], display: "swap", preload: false });
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-ar",
  weight: ["300", "400", "600", "700"],
  subsets: ["arabic"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Sawad Holding", template: "%s · Sawad Holding" },
  description: "Gated garden compounds in Baghdad, Erbil and Basra. Villas and apartments among date palms and moving water.",
  applicationName: "Sawad Holding",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f2ea",
};

const FONT_CLASSES = [young.variable, manrope.variable, amiri.variable, plexArabic.variable].join(" ");

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={FONT_CLASSES}>
      <body>{children}</body>
    </html>
  );
}
