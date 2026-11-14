import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Oswald } from "next/font/google";
import "./globals.css";

// Dos familias: Oswald (condensada, para importes y títulos) y Atkinson
// Hyperlegible (para todo lo que se lee de prisa).
const condensada = Oswald({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-oswald", display: "swap" });
const legible = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sin Tranza · Mostrador",
  description: "Cobra con QR CoDi y entérate al instante de que ya cayó el pago.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#F6F3EA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={`${condensada.variable} ${legible.variable}`}>
      <body>{children}</body>
    </html>
  );
}
