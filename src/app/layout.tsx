import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "TelePC — o teu PC no telemóvel",
  description:
    "Comando remoto total: espelho do ecrã, rato, teclado, janelas, terminal e macros do teu PC a partir do iPhone.",
  applicationName: "TelePC",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TelePC",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#05070c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt">
      <body className="min-h-dvh bg-ink-950 text-mist-100 antialiased">{children}</body>
    </html>
  );
}
