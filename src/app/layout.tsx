import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: {
    default: "Noisia | Social Intelligence Architects",
    template: "%s | Noisia"
  },
  description: site.description,
  icons: {
    icon: "/favicon.svg"
  },
  openGraph: {
    title: "Noisia",
    description: site.description,
    type: "website"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
